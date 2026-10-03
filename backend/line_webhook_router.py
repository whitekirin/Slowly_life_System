import base64
import hashlib
import hmac
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from backend.config import settings
from backend.database import get_session
from backend.line_actions import list_available_actions
from backend.line_menu_config import menu_for
from backend.line_richmenu import POSTBACK_PREFIX, sync_user_rich_menu
from backend.line_utils import build_action_menu_flex, get_user_by_line_id, line_logger, reply_line_message

router = APIRouter(prefix="/line", tags=["line-webhook"])

MENU_KEYWORDS = {"選單", "menu", "操作", "功能"}


def _verify_signature(body: bytes, signature: str) -> bool:
    expected = base64.b64encode(
        hmac.new((settings.LINE_MESSAGING_CHANNEL_SECRET or settings.LINE_CHANNEL_SECRET).encode("utf-8"), body, hashlib.sha256).digest()
    ).decode("utf-8")
    return hmac.compare_digest(expected, signature or "")


UNBOUND_MESSAGE = "此 LINE 帳號尚未綁定系統帳號，請先登入系統並於「個人設定」完成 LINE 綁定。"


def _requested_menu(event: dict) -> tuple[bool, Optional[str]]:
    """(是否要回選單, 指定的分組)。文字訊息含關鍵字 → 全部分組；圖文選單的 postback → 該分組；
    加好友（follow）→ 全部分組。"""
    event_type = event.get("type")
    if event_type == "follow":
        return True, None
    if event_type == "postback":
        data = event.get("postback", {}).get("data", "")
        if data.startswith(POSTBACK_PREFIX):
            return True, data[len(POSTBACK_PREFIX):]
        return False, None
    if event_type == "message" and event.get("message", {}).get("type") == "text":
        text = event.get("message", {}).get("text", "")
        return any(keyword in text for keyword in MENU_KEYWORDS), None
    return False, None


def handle_line_event(session: Session, event: dict) -> None:
    """Process a single webhook event. Never raises — a malformed or unexpected
    event must not take down the rest of the batch or make the webhook return
    a non-200 (which would make LINE keep retrying delivery)."""
    try:
        wants_menu, group_code = _requested_menu(event)
        if not wants_menu:
            return

        reply_token = event.get("replyToken")
        line_user_id = event.get("source", {}).get("userId")
        if not reply_token or not line_user_id:
            return

        user = get_user_by_line_id(session, line_user_id)
        if not user:
            reply_line_message(reply_token, [{"type": "text", "text": UNBOUND_MESSAGE}], message_type="unbound_menu_request")
            return

        if event.get("type") == "follow":
            # 封鎖後再加回來，或第一次加好友前就已經在系統綁定過：補上他該看到的圖文選單
            sync_user_rich_menu(session, user, line_user_id)

        if not user.is_active:
            reply_line_message(
                reply_token,
                [{"type": "text", "text": "此帳號已被停用，如有疑問請聯繫系統管理員。"}],
                message_type="inactive_menu_request",
            )
            return

        if group_code == "bind_help":  # 已綁定的人點到舊的「尚未綁定」選單：改回給他完整選單
            group_code = None
            sync_user_rich_menu(session, user, line_user_id)

        menu = menu_for(session)
        actions = list_available_actions(user, session, menu.actions)
        reply_line_message(reply_token, [build_action_menu_flex(actions, group_code, menu.groups)], message_type="menu")
    except Exception:
        line_logger.exception("LINE_WEBHOOK_EVENT_ERROR")


@router.post("/webhook")
async def line_webhook(request: Request, session: Session = Depends(get_session)):
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    for event in payload.get("events", []):
        handle_line_event(session, event)

    return {"ok": True}
