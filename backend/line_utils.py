import logging
import uuid
from typing import TYPE_CHECKING, Optional
from urllib.parse import urlencode

import httpx
from sqlmodel import Session, select

from backend.config import settings
from backend.models import User, UserLineBinding

if TYPE_CHECKING:
    from backend.line_actions import LineAction, LineMenuGroup

# --- Logging Setup ---
line_logger = logging.getLogger("line_delivery")
line_logger.setLevel(logging.INFO)
_file_handler = logging.FileHandler("line_delivery.log")
_file_handler.setFormatter(logging.Formatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%dT%H:%M:%S%z'))
line_logger.addHandler(_file_handler)

# --- Prometheus Metrics ---
try:
    from prometheus_client import Counter
    LINE_PUSH_SENT_TOTAL = Counter("line_push_sent_total", "Total LINE push messages sent successfully", ["type"])
    LINE_PUSH_FAILED_TOTAL = Counter("line_push_failed_total", "Total LINE push messages failed to send", ["type", "reason"])
except ImportError:
    class DummyCounter:
        def __init__(self, *args, **kwargs): pass
        def labels(self, *args, **kwargs): return self
        def inc(self, *args, **kwargs): pass
    LINE_PUSH_SENT_TOTAL = DummyCounter()
    LINE_PUSH_FAILED_TOTAL = DummyCounter()

LINE_LOGIN_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize"
LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"
LINE_PROFILE_URL = "https://api.line.me/v2/profile"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"
LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"


def build_line_login_url(state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.LINE_CHANNEL_ID,
        "redirect_uri": settings.LINE_LOGIN_CALLBACK_URL,
        "state": state,
        "scope": "profile openid",
    }
    return f"{LINE_LOGIN_AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code_for_token(code: str) -> dict:
    """Exchange an OAuth authorization code for an access token. Raises httpx.HTTPStatusError on failure."""
    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            LINE_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.LINE_LOGIN_CALLBACK_URL,
                "client_id": settings.LINE_CHANNEL_ID,
                "client_secret": settings.LINE_CHANNEL_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        return response.json()


def get_line_profile(access_token: str) -> dict:
    """Fetch the LINE profile (userId, displayName) for a user access token."""
    with httpx.Client(timeout=10.0) as client:
        response = client.get(LINE_PROFILE_URL, headers={"Authorization": f"Bearer {access_token}"})
        response.raise_for_status()
        return response.json()


def push_line_message_sync(line_user_id: Optional[str], text: str, message_type: str = "generic") -> bool:
    """Push a text message to a LINE user. Never raises — failures are logged and swallowed
    so that push failures can never break the calling business operation (e.g. receiving a
    purchase order or shipping a sales order)."""
    message_id = str(uuid.uuid4())

    if not line_user_id:
        line_logger.info(f"LINE_SKIP message-id={message_id} reason=no_binding type={message_type}")
        return False

    if settings.LINE_SUPPRESS_SEND:
        line_logger.info(f"LINE_MOCK message-id={message_id} recipient={line_user_id} type={message_type} response=suppressed_by_config text={text!r}")
        LINE_PUSH_SENT_TOTAL.labels(type=message_type).inc()
        return True

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                LINE_PUSH_URL,
                json={"to": line_user_id, "messages": [{"type": "text", "text": text}]},
                headers={
                    "Authorization": f"Bearer {settings.LINE_MESSAGING_ACCESS_TOKEN}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
        line_logger.info(f"LINE_DELIVERED message-id={message_id} recipient={line_user_id} type={message_type} response=200_OK")
        LINE_PUSH_SENT_TOTAL.labels(type=message_type).inc()
        return True
    except Exception as e:
        error_msg = str(e).replace('\n', ' ')
        line_logger.error(f"LINE_FAILED message-id={message_id} recipient={line_user_id} type={message_type} response=error reason='{error_msg}'")
        LINE_PUSH_FAILED_TOTAL.labels(type=message_type, reason="api_error").inc()
        return False


def build_purchase_received_message(po) -> str:
    return (
        f"[進貨完成通知]\n"
        f"採購單編號：PO-{po.id}\n"
        f"供應商：{po.supplier_name}\n"
        f"總金額：{po.total_amount}\n"
        f"狀態已更新為「已到貨」"
    )


def build_sale_shipped_message(so) -> str:
    return (
        f"[出貨完成通知]\n"
        f"銷貨單編號：SO-{so.id}\n"
        f"狀態已更新為「已出貨」"
    )


PLATFORM_LABELS = {"shopee": "蝦皮", "amazon": "Amazon", "manual": "手動/其他"}


def build_sales_order_created_message(so, item_lines: list[str]) -> str:
    """建立出貨單時推給 admin 與撿貨人員的訊息；站內通知也用同一段內容。"""
    lines = [
        "[新出貨單通知]",
        f"出貨單號：{so.order_number}",
        f"平台：{PLATFORM_LABELS.get(so.platform, so.platform)}",
        f"客戶編號：{so.customer_id}",
        f"出貨人：{so.shipped_by}",
        f"總數量：{so.total_quantity}，總金額：{so.total_amount}",
    ]
    if so.platform == "shopee":
        lines.append(f"蝦皮出貨 QRcode：{'已上傳' if so.shopee_qrcode_image else '未上傳'}")
    lines.append("出貨商品：")
    lines.extend(item_lines)
    return "\n".join(lines)


def build_sales_order_updated_message(so, updated_by: str, changes: list[str]) -> str:
    """出貨單有更新時推給撿貨人員的訊息，changes 是「欄位：舊 → 新」之類的變更說明。"""
    lines = [
        "[出貨單更新通知]",
        f"出貨單號：{so.order_number}",
        f"平台：{PLATFORM_LABELS.get(so.platform, so.platform)}",
        f"客戶編號：{so.customer_id}",
        f"更新人：{updated_by}",
        "變更內容：",
    ]
    lines.extend(changes)
    return "\n".join(lines)


def get_user_by_line_id(session: Session, line_user_id: str) -> Optional[User]:
    """Reverse lookup of UserLineBinding: LINE userId -> the bound system User."""
    binding = session.exec(
        select(UserLineBinding).where(UserLineBinding.line_user_id == line_user_id)
    ).first()
    if not binding:
        return None
    return session.get(User, binding.user_id)


def verify_liff_id_token(id_token: str) -> dict:
    """Verify a LIFF ID token via LINE's own verify endpoint and return its claims
    (sub, aud, exp, iss, ...). Raises httpx.HTTPStatusError if LINE rejects the token."""
    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            LINE_VERIFY_URL,
            data={
                "id_token": id_token,
                "client_id": settings.LIFF_CHANNEL_ID or settings.LINE_CHANNEL_ID,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        return response.json()


def reply_line_message(reply_token: str, messages: list[dict], message_type: str = "generic") -> bool:
    """Reply to a webhook event. Mirrors push_line_message_sync's never-raise,
    LINE_SUPPRESS_SEND-aware behavior so webhook handling can never 500 because
    LINE's reply API is unreachable."""
    message_id = str(uuid.uuid4())

    if settings.LINE_SUPPRESS_SEND:
        line_logger.info(f"LINE_MOCK_REPLY message-id={message_id} reply_token={reply_token} type={message_type} response=suppressed_by_config messages={messages!r}")
        LINE_PUSH_SENT_TOTAL.labels(type=message_type).inc()
        return True

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                LINE_REPLY_URL,
                json={"replyToken": reply_token, "messages": messages},
                headers={
                    "Authorization": f"Bearer {settings.LINE_MESSAGING_ACCESS_TOKEN}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
        line_logger.info(f"LINE_REPLIED message-id={message_id} reply_token={reply_token} type={message_type} response=200_OK")
        LINE_PUSH_SENT_TOTAL.labels(type=message_type).inc()
        return True
    except Exception as e:
        error_msg = str(e).replace('\n', ' ')
        line_logger.error(f"LINE_REPLY_FAILED message-id={message_id} reply_token={reply_token} type={message_type} response=error reason='{error_msg}'")
        LINE_PUSH_FAILED_TOTAL.labels(type=message_type, reason="api_error").inc()
        return False


def _action_rows(actions: "list[LineAction]", accent: str) -> list[dict]:
    """每個功能一列可點的淺色條，點了開 LIFF 頁。"""
    return [
        {
            "type": "box",
            "layout": "horizontal",
            "paddingAll": "12px",
            "cornerRadius": "10px",
            "backgroundColor": "#F8F3EA",
            "action": {
                "type": "uri",
                "label": action.label[:20],  # LINE 按鈕文字上限 20 字
                "uri": f"https://liff.line.me/{settings.LIFF_ID}{action.liff_path}",
            },
            "contents": [
                {"type": "text", "text": action.label, "size": "sm", "color": "#3E352D", "weight": "bold", "flex": 1, "gravity": "center"},
                {"type": "text", "text": "›", "size": "lg", "color": accent, "flex": 0, "gravity": "center"},
            ],
        }
        for action in actions
    ]


def _group_bubble(group: "LineMenuGroup", actions: "list[LineAction]") -> dict:
    """一個分組一張卡（慢生活風格）：上方分組色的淡底標頭，下面是功能列表。"""
    from backend.line_menu_config import palette_of

    colors = palette_of(group.color)
    header = [{"type": "text", "text": group.label, "weight": "bold", "size": "lg", "color": colors["ink"]}]
    if group.subtitle:
        header.append({"type": "text", "text": group.subtitle, "size": "xs", "color": "#66594C", "margin": "xs"})
    return {
        "type": "bubble",
        "size": "mega",
        "header": {"type": "box", "layout": "vertical", "backgroundColor": colors["tint"], "paddingAll": "16px", "contents": header},
        "body": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#FFFDF8",
            "paddingAll": "12px",
            "spacing": "sm",
            "contents": _action_rows(actions, colors["accent"]),
        },
    }


NO_ACTIONS_MESSAGE = {
    "type": "text",
    "text": "目前沒有可在 LINE 使用的操作，如需協助請聯繫系統管理員。",
}


def build_action_menu_flex(actions: "list[LineAction]", group_code: Optional[str] = None, groups: "Optional[list[LineMenuGroup]]" = None) -> dict:
    """Build a Flex Message of the operations a user is permitted to use, one bubble
    per menu group (a carousel), in the order of `groups` (the 「LINE 介面設定」 menu).
    With group_code (a rich menu tile was tapped) only that group's bubble is sent.
    Each action is one row opening its LIFF page."""
    from backend.line_actions import group_actions

    grouped = group_actions(actions, groups)
    if group_code is not None:
        grouped = [(g, a) for g, a in grouped if g.code == group_code]
    if not grouped:
        return NO_ACTIONS_MESSAGE

    bubbles = [_group_bubble(group, group_items) for group, group_items in grouped]
    return {
        "type": "flex",
        "altText": grouped[0][0].label if len(grouped) == 1 else "操作選單",
        "contents": bubbles[0] if len(bubbles) == 1 else {"type": "carousel", "contents": bubbles},
    }
