from typing import List, Optional
from datetime import datetime, timedelta
import random
import string
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, desc
from backend.database import get_session
from backend.models import PointExchangeEvent, PointExchangeEventRead, PointExchangeRecord, PointExchangeRecordRead, Member, MailSymbol
from backend.members import get_current_member
from backend.email_utils import send_discount_email
from backend.ws_manager import manager
import asyncio

router = APIRouter(prefix="/api/v1/points", tags=["points_store"])

@router.get("/events", response_model=List[PointExchangeEventRead])
async def list_exchange_events(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    """List active points exchange events for members"""
    query = select(PointExchangeEvent).where(PointExchangeEvent.is_active == True).order_by(PointExchangeEvent.required_points)
    events = session.exec(query).all()
    return events

@router.post("/exchange/{event_id}", response_model=PointExchangeRecordRead)
async def exchange_points(
    event_id: int,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    """Exchange points for a discount code"""
    event = session.get(PointExchangeEvent, event_id)
    if not event or not event.is_active:
        raise HTTPException(status_code=404, detail="兌換活動不存在或已下架 (Event not found)")

    # Re-fetch member to get latest points with a lock if possible, but we keep it simple here
    member = session.get(Member, current_member.id)
    
    if member.points < event.required_points:
        raise HTTPException(status_code=400, detail="紅利點數不足 (Insufficient points)")

    # Deduct points
    member.points -= event.required_points
    
    # Generate Code
    if event.discount_code_template:
        # Use template + random suffix
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        code = f"{event.discount_code_template}-{suffix}"
    else:
        # Random
        code = "VIP-" + ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

    valid_until = datetime.now() + timedelta(days=event.valid_days)
    
    # Create Record
    record = PointExchangeRecord(
        member_id=member.id,
        event_id=event.id,
        points_used=event.required_points,
        valid_until=valid_until
    )
    
    session.add(member)
    session.add(record)
    
    # Send MailSymbol (Internal Inbox)
    mail_symbol = MailSymbol(
        member_id=member.id,
        symbol_type="promo",
        title=f"您的兌換碼: {event.title}",
        content=f"恭喜您成功兌換！您的專屬折扣碼為：{code}。有效期限至 {valid_until.strftime('%Y-%m-%d %H:%M')}。{event.description or ''}",
        metadata_json={"discount_code": code, "event_title": event.title, "valid_until": valid_until.isoformat()}
    )
    session.add(mail_symbol)
    
    session.commit()
    session.refresh(record)

    # Broadcast new mail event to user
    asyncio.create_task(manager.send_personal_message({"type": "NEW_MAIL", "mail_id": str(mail_symbol.id)}, member.id))

    # Send Email with Retry Logic
    if member.email and getattr(member, 'email_status', 'active') == 'active':
        async def _send_email_with_retry():
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    success = await send_discount_email(member.email, code, event.title, valid_until, event.description or "")
                    if success:
                        break
                except Exception as e:
                    print(f"Failed to send email (attempt {attempt + 1}/{max_retries}):", e)
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1) # wait 1 second before retry
        
        # Fire and forget the email sending to not block the API response
        asyncio.create_task(_send_email_with_retry())

    return PointExchangeRecordRead(
        id=record.id,
        event_id=event.id,
        event_title=event.title,
        points_used=record.points_used,
        status=record.status,
        valid_until=record.valid_until,
        created_at=record.created_at
    )

@router.get("/history", response_model=List[PointExchangeRecordRead])
async def get_exchange_history(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    """Get member's exchange history"""
    records = session.exec(
        select(PointExchangeRecord)
        .where(PointExchangeRecord.member_id == current_member.id)
        .order_by(desc(PointExchangeRecord.created_at))
    ).all()
    
    results = []
    for r in records:
        event = session.get(PointExchangeEvent, r.event_id)
        results.append(PointExchangeRecordRead(
            id=r.id,
            event_id=r.event_id,
            event_title=event.title if event else "Unknown Event",
            points_used=r.points_used,
            status=r.status,
            valid_until=r.valid_until,
            created_at=r.created_at
        ))
        
    return results
