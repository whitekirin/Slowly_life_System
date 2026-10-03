import logging
import time
import bleach
from typing import List, Optional
from datetime import datetime, timedelta
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from sqlmodel import Session, select, desc
from backend.database import get_session
from backend.models import MailSymbol, MailSymbolCreate, MailSymbolRead, User, Member
from backend.auth import get_current_user
from backend.members import get_current_member
from backend.ws_manager import manager
import asyncio

# Whitelist-based sanitizer for member mail-symbol content (rendered via
# dangerouslySetInnerHTML on the member frontend). The previous filter only
# stripped the literal substring "<script>", which any case variation, split
# tag, or event-handler attribute (onerror=, onload=, ...) bypassed entirely —
# see security audit #10.
_ALLOWED_TAGS = ["b", "i", "u", "strong", "em", "br", "p", "a", "ul", "ol", "li", "span", "div", "img"]
_ALLOWED_ATTRS = {"a": ["href", "title", "target"], "img": ["src", "alt", "width", "height"]}
_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

def sanitize_mail_content(content: str) -> str:
    return bleach.clean(
        content,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
    )

router = APIRouter(prefix="/api/v1", tags=["mail_symbols"])

# --- Logging Setup ---
mail_logger = logging.getLogger("mail_symbols")
mail_logger.setLevel(logging.INFO)
file_handler = logging.FileHandler("application.log")
file_handler.setFormatter(logging.Formatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%dT%H:%M:%S%z'))
mail_logger.addHandler(file_handler)

# --- Prometheus Metrics ---
try:
    from prometheus_client import Counter
    MAIL_SYMBOLS_CREATED_TOTAL = Counter("mail_symbols_created_total", "Total mail symbols created", ["symbol_type"])
    MAIL_SYMBOLS_READ_TOTAL = Counter("mail_symbols_read_total", "Total mail symbols marked as read")
except ImportError:
    # Dummy implementation if prometheus_client is not installed
    class DummyCounter:
        def __init__(self, *args, **kwargs): pass
        def labels(self, *args, **kwargs): return self
        def inc(self, *args, **kwargs): pass
    MAIL_SYMBOLS_CREATED_TOTAL = DummyCounter()
    MAIL_SYMBOLS_READ_TOTAL = DummyCounter()


# --- APIs ---

@router.post("/members/{memberId}/mail-symbols", status_code=201)
async def create_mail_symbol(
    memberId: int,
    payload: MailSymbolCreate,
    response: Response,
    current_user: User = Depends(get_current_user), # Requires main system user
    session: Session = Depends(get_session)
):
    # Security check: must be a system call (superuser or has system permission)
    if not current_user.is_superuser and "system" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Forbidden: System access required")

    content = sanitize_mail_content(payload.content)

    # Deduplication logic: Check for exactly same type, title, content within 24h
    time_limit = datetime.now() - timedelta(hours=24)
    existing = session.exec(
        select(MailSymbol)
        .where(MailSymbol.member_id == memberId)
        .where(MailSymbol.symbol_type == payload.symbolType)
        .where(MailSymbol.title == payload.title)
        .where(MailSymbol.content == content)
        .where(MailSymbol.created_at >= time_limit)
    ).first()

    if existing:
        response.status_code = 200 # Return 200 instead of 201 for duplicate
        return {"mailSymbolId": str(existing.id)}

    new_symbol = MailSymbol(
        member_id=memberId,
        symbol_type=payload.symbolType,
        title=payload.title,
        content=content,
        # payload.metadata (not .symbol_metadata) silently resolved to
        # SQLModel's own reserved `metadata` class attribute (a SQLAlchemy
        # MetaData registry object) instead of the field's value, since the
        # "metadata" name here is only a Pydantic alias for symbol_metadata —
        # attribute access still goes by the field name. That made every call
        # to this endpoint fail with a JSON-serialization error at insert time.
        metadata_json=payload.symbol_metadata
    )
    session.add(new_symbol)
    session.commit()
    session.refresh(new_symbol)

    # Logging & Metrics
    mail_logger.info(f"MAIL_SYMBOL memberId={memberId} action=create id={new_symbol.id}")
    MAIL_SYMBOLS_CREATED_TOTAL.labels(symbol_type=payload.symbolType).inc()

    return {"mailSymbolId": str(new_symbol.id)}

@router.get("/members/{memberId}/mail-symbols", response_model=List[MailSymbolRead])
async def list_mail_symbols(
    memberId: int,
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    symbolType: Optional[str] = None,
    isRead: Optional[bool] = None,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    if current_member.id != memberId:
        raise HTTPException(status_code=403, detail="Forbidden: Cannot access other member's mails")

    query = select(MailSymbol).where(MailSymbol.member_id == memberId)
    
    if symbolType:
        query = query.where(MailSymbol.symbol_type == symbolType)
    if isRead is not None:
        query = query.where(MailSymbol.is_read == isRead)
        
    query = query.order_by(desc(MailSymbol.created_at)).offset((page - 1) * size).limit(size)
    results = session.exec(query).all()

    # Map DB model to Response Model
    return [
        MailSymbolRead(
            id=r.id,
            memberId=r.member_id,
            symbolType=r.symbol_type,
            title=r.title,
            content=r.content,
            symbol_metadata=r.metadata_json,
            isRead=r.is_read,
            readAt=r.read_at,
            createdAt=r.created_at,
            updatedAt=r.updated_at
        ) for r in results
    ]

@router.patch("/mail-symbols/{mailSymbolId}/read")
async def mark_mail_symbol_read(
    mailSymbolId: uuid.UUID,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    symbol = session.get(MailSymbol, mailSymbolId)
    if not symbol:
        raise HTTPException(status_code=404, detail="Mail symbol not found")
        
    if symbol.member_id != current_member.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not symbol.is_read:
        symbol.is_read = True
        symbol.read_at = datetime.now()
        symbol.updated_at = datetime.now()
        session.add(symbol)
        session.commit()

        # Logging & Metrics
        mail_logger.info(f"MAIL_SYMBOL memberId={current_member.id} action=read id={symbol.id}")
        MAIL_SYMBOLS_READ_TOTAL.inc()

        # Broadcast read event
        asyncio.create_task(manager.send_personal_message({"type": "MAIL_READ", "mail_id": str(symbol.id)}, current_member.id))

    return {"status": "success", "readAt": symbol.read_at.isoformat() if symbol.read_at else None}
