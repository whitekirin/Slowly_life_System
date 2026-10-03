import asyncio
import json
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response, RedirectResponse
from sqlmodel import Session, select, desc
import traceback

from backend.database import get_session
from backend.models import (
    MessageTemplate, MessageTemplateCreate, MessageTemplateUpdate,
    TargetSegment, TargetSegmentCreate, TargetSegmentUpdate,
    Campaign, CampaignCreate, CampaignUpdate, CampaignLog,
    AutomatedTrigger, AutomatedTriggerCreate, AutomatedTriggerUpdate,
    User, Member, MailSymbol
)
from backend.auth import get_current_user, require_permissions
from backend.email_utils import conf
from backend.config import settings
from backend.ws_manager import manager
from fastapi_mail import FastMail, MessageSchema, MessageType

router = APIRouter(prefix="/marketing", tags=["marketing"])

# --- Templates ---
@router.get("/templates", response_model=List[MessageTemplate])
async def list_templates(
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(require_permissions(["view_marketing"])),
    session: Session = Depends(get_session)
):
    return session.exec(select(MessageTemplate).offset(skip).limit(limit).order_by(desc(MessageTemplate.created_at))).all()

@router.post("/templates", response_model=MessageTemplate)
async def create_template(
    template: MessageTemplateCreate,
    current_user: User = Depends(require_permissions(["create_marketing"])),
    session: Session = Depends(get_session)
):
    db_template = MessageTemplate.from_orm(template)
    session.add(db_template)
    session.commit()
    session.refresh(db_template)
    return db_template

@router.patch("/templates/{template_id}", response_model=MessageTemplate)
async def update_template(
    template_id: int, template_update: MessageTemplateUpdate,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    db_template = session.get(MessageTemplate, template_id)
    if not db_template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    update_data = template_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_template, key, value)
    db_template.updated_at = datetime.now()
    session.add(db_template)
    session.commit()
    session.refresh(db_template)
    return db_template

@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    db_template = session.get(MessageTemplate, template_id)
    if not db_template:
        raise HTTPException(status_code=404, detail="Template not found")
    session.delete(db_template)
    session.commit()
    return {"ok": True}

# --- Segments ---
@router.get("/segments", response_model=List[TargetSegment])
async def list_segments(
    current_user: User = Depends(require_permissions(["view_marketing"])),
    session: Session = Depends(get_session)
):
    return session.exec(select(TargetSegment).order_by(desc(TargetSegment.created_at))).all()

@router.post("/segments", response_model=TargetSegment)
async def create_segment(
    segment: TargetSegmentCreate,
    current_user: User = Depends(require_permissions(["create_marketing"])),
    session: Session = Depends(get_session)
):
    db_segment = TargetSegment.from_orm(segment)
    session.add(db_segment)
    session.commit()
    session.refresh(db_segment)
    return db_segment

@router.patch("/segments/{segment_id}", response_model=TargetSegment)
async def update_segment(
    segment_id: int, segment_update: TargetSegmentUpdate,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    db_segment = session.get(TargetSegment, segment_id)
    if not db_segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    
    update_data = segment_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_segment, key, value)
    session.add(db_segment)
    session.commit()
    session.refresh(db_segment)
    return db_segment

@router.delete("/segments/{segment_id}")
async def delete_segment(
    segment_id: int,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    db_segment = session.get(TargetSegment, segment_id)
    if not db_segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    session.delete(db_segment)
    session.commit()
    return {"ok": True}

# --- Campaigns ---
@router.get("/campaigns", response_model=List[Campaign])
async def list_campaigns(
    current_user: User = Depends(require_permissions(["view_marketing"])),
    session: Session = Depends(get_session)
):
    return session.exec(select(Campaign).order_by(desc(Campaign.created_at))).all()

@router.get("/campaigns/{campaign_id}/stats")
async def get_campaign_stats(
    campaign_id: int,
    current_user: User = Depends(require_permissions(["view_marketing"])),
    session: Session = Depends(get_session)
):
    campaign = session.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    logs = session.exec(select(CampaignLog).where(CampaignLog.campaign_id == campaign_id)).all()
    return {
        "sent_count": campaign.sent_count,
        "open_count": campaign.open_count,
        "click_count": campaign.click_count,
        "total_targets": len(logs)
    }

def get_members_for_segment(segment: Optional[TargetSegment], session: Session) -> List[Member]:
    query = select(Member).where(Member.is_active == True)
    if segment and segment.filter_rules:
        rules = segment.filter_rules
        if "level" in rules and rules["level"]:
            query = query.where(Member.level == rules["level"])
        if "min_points" in rules and rules["min_points"] is not None:
            query = query.where(Member.points >= rules["min_points"])
        if "member_ids" in rules and isinstance(rules["member_ids"], list):
            query = query.where(Member.id.in_(rules["member_ids"]))
    return session.exec(query).all()

async def execute_campaign(campaign_id: int, session: Session):
    campaign = session.get(Campaign, campaign_id)
    if not campaign or campaign.status != "scheduled":
        return

    campaign.status = "processing"
    session.add(campaign)
    session.commit()

    segment = session.get(TargetSegment, campaign.segment_id) if campaign.segment_id else None
    members = get_members_for_segment(segment, session)
    
    fastmail = FastMail(conf) if conf.MAIL_PASSWORD else None

    for member in members:
        # Personalize
        subject = campaign.subject.replace("{{name}}", member.name)
        content = campaign.content_html.replace("{{name}}", member.name).replace("{{points}}", str(member.points))
        
        metadata = campaign.metadata_json or {}
        discount_code = metadata.get("discountCode")
        action_url = metadata.get("actionUrl")
        
        # Attachments Processing
        attachment_html = ""
        if discount_code:
            attachment_html += f'<div style="margin-top:20px;padding:15px;background:#f6ffed;border:1px solid #b7eb8f;text-align:center;"><b>專屬優惠碼：</b><h2 style="color:#52c41a;margin:10px 0;">{discount_code}</h2></div>'
        if action_url:
            attachment_html += f'<div style="margin-top:15px;text-align:center;"><a href="{action_url}" style="display:inline-block;padding:10px 20px;background:#1890ff;color:#fff;text-decoration:none;border-radius:4px;">前往活動連結</a></div>'

        final_content = content + attachment_html

        for channel in campaign.channels:
            log = CampaignLog(campaign_id=campaign.id, member_id=member.id, channel=channel)
            session.add(log)
            session.commit()
            session.refresh(log)

            # Append Tracking Pixel
            tracking_pixel = f'<img src="{settings.PUBLIC_BASE_URL}/marketing/track/open/{log.id}.gif" width="1" height="1" />'
            final_content = content + tracking_pixel

            try:
                if channel == "email" and member.email and getattr(member, 'email_status', 'active') == 'active':
                    if fastmail:
                        msg = MessageSchema(
                            subject=subject,
                            recipients=[member.email],
                            body=final_content,
                            subtype=MessageType.html
                        )
                        await fastmail.send_message(msg)
                    log.status = "sent"
                    log.sent_at = datetime.now()
                    campaign.sent_count += 1
                elif channel == "in_app":
                    mail_symbol = MailSymbol(
                        member_id=member.id,
                        symbol_type="promo" if discount_code else "campaign",
                        title=subject,
                        content=final_content,
                        metadata_json={"campaign_id": campaign.id, "log_id": log.id, "discountCode": discount_code, "actionUrl": action_url}
                    )
                    session.add(mail_symbol)
                    log.status = "sent"
                    log.sent_at = datetime.now()
                    campaign.sent_count += 1
                    # Notify
                    await manager.send_personal_message({"type": "NEW_MAIL", "mail_id": str(mail_symbol.id)}, member.id)
                else:
                    log.status = "failed"
                    log.error_msg = "Invalid channel or missing contact info"
            except Exception as e:
                log.status = "failed"
                log.error_msg = str(e)
                traceback.print_exc()

            session.add(log)
    
    campaign.status = "completed"
    session.add(campaign)
    session.commit()


class DirectSendRequest(BaseModel):
    member_ids: List[int]
    subject: str
    content_html: str
    channels: List[str] = ["in_app"]
    metadata_json: Optional[Dict] = {}

@router.post("/direct_send")
async def direct_send_message(
    req: DirectSendRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permissions(["create_marketing"])),
    session: Session = Depends(get_session)
):
    # Create a hidden custom segment
    segment = TargetSegment(
        name=f"Direct Send {datetime.now().strftime('%Y%m%d%H%M%S')}",
        description="Auto-generated for direct send",
        filter_rules={"member_ids": req.member_ids}
    )
    session.add(segment)
    session.commit()
    session.refresh(segment)

    # Create a campaign
    campaign = Campaign(
        name=f"Direct Message - {req.subject[:20]}",
        subject=req.subject,
        content_html=req.content_html,
        channels=req.channels,
        segment_id=segment.id,
        scheduled_at=datetime.now(),
        status="scheduled",
        metadata_json=req.metadata_json
    )
    session.add(campaign)
    session.commit()
    session.refresh(campaign)

    background_tasks.add_task(execute_campaign, campaign.id, session)
    return {"ok": True, "campaign_id": campaign.id}
@router.post("/campaigns", response_model=Campaign)
async def create_campaign(
    campaign: CampaignCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permissions(["create_marketing"])),
    session: Session = Depends(get_session)
):
    db_campaign = Campaign.from_orm(campaign)
    if db_campaign.status == "scheduled" and not db_campaign.scheduled_at:
        db_campaign.scheduled_at = datetime.now()
    
    session.add(db_campaign)
    session.commit()
    session.refresh(db_campaign)
    
    if db_campaign.status == "scheduled" and db_campaign.scheduled_at <= datetime.now():
        background_tasks.add_task(execute_campaign, db_campaign.id, session)
        
    return db_campaign

@router.patch("/campaigns/{campaign_id}/status")
async def update_campaign_status(
    campaign_id: int, status: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    campaign = session.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    campaign.status = status
    if status == "scheduled":
        if not campaign.scheduled_at:
            campaign.scheduled_at = datetime.now()
        if campaign.scheduled_at <= datetime.now():
            session.add(campaign)
            session.commit()
            background_tasks.add_task(execute_campaign, campaign.id, session)
            return campaign
            
    session.add(campaign)
    session.commit()
    session.refresh(campaign)
    return campaign

# --- Tracking Pixels & Links ---

@router.get("/track/open/{log_id}.gif")
async def track_open(log_id: int, session: Session = Depends(get_session)):
    log = session.get(CampaignLog, log_id)
    if log and not log.opened_at:
        log.opened_at = datetime.now()
        log.status = "opened"
        campaign = session.get(Campaign, log.campaign_id)
        if campaign:
            campaign.open_count += 1
            session.add(campaign)
        session.add(log)
        session.commit()
        
    # 1x1 transparent GIF
    pixel = b'\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b'
    return Response(content=pixel, media_type="image/gif")

@router.get("/track/click/{log_id}")
async def track_click(log_id: int, url: str, session: Session = Depends(get_session)):
    log = session.get(CampaignLog, log_id)
    if log:
        if not log.opened_at:
            log.opened_at = datetime.now()
            campaign = session.get(Campaign, log.campaign_id)
            if campaign:
                campaign.open_count += 1
                session.add(campaign)
        if not log.clicked_at:
            log.clicked_at = datetime.now()
            log.status = "clicked"
            campaign = session.get(Campaign, log.campaign_id)
            if campaign:
                campaign.click_count += 1
                session.add(campaign)
        session.add(log)
        session.commit()
        
    return RedirectResponse(url=url)

# --- Triggers ---
@router.get("/triggers", response_model=List[AutomatedTrigger])
async def list_triggers(
    current_user: User = Depends(require_permissions(["view_marketing"])),
    session: Session = Depends(get_session)
):
    return session.exec(select(AutomatedTrigger)).all()

@router.post("/triggers", response_model=AutomatedTrigger)
async def create_trigger(
    trigger: AutomatedTriggerCreate,
    current_user: User = Depends(require_permissions(["create_marketing"])),
    session: Session = Depends(get_session)
):
    db_trigger = AutomatedTrigger.from_orm(trigger)
    session.add(db_trigger)
    session.commit()
    session.refresh(db_trigger)
    return db_trigger

@router.delete("/triggers/{trigger_id}")
async def delete_trigger(
    trigger_id: int,
    current_user: User = Depends(require_permissions(["edit_marketing"])),
    session: Session = Depends(get_session)
):
    db_trigger = session.get(AutomatedTrigger, trigger_id)
    if not db_trigger:
        raise HTTPException(status_code=404, detail="Trigger not found")
    session.delete(db_trigger)
    session.commit()
    return {"ok": True}
