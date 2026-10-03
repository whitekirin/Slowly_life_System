import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from backend.config import settings
from backend.database import get_session
from backend.line_utils import get_user_by_line_id, verify_liff_id_token
from backend.models import User

liff_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_line_user(
    credentials: HTTPAuthorizationCredentials = Depends(liff_bearer_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Authenticate a LIFF request using the LINE-issued ID token (there is no
    system JWT here — the caller never logged into the ERP directly, they opened
    a LIFF page inside LINE)."""
    if not credentials:
        raise HTTPException(status_code=401, detail="缺少 LIFF 登入憑證")

    try:
        claims = verify_liff_id_token(credentials.credentials)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=401, detail="LIFF 憑證驗證失敗")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="向 LINE 驗證身分時發生錯誤，請稍後再試")

    expected_aud = settings.LIFF_CHANNEL_ID or settings.LINE_CHANNEL_ID
    if expected_aud and claims.get("aud") != expected_aud:
        raise HTTPException(status_code=401, detail="LIFF 憑證來源不符")

    line_user_id = claims.get("sub")
    if not line_user_id:
        raise HTTPException(status_code=401, detail="LIFF 憑證缺少使用者識別")

    user = get_user_by_line_id(session, line_user_id)
    if not user:
        raise HTTPException(status_code=403, detail="此 LINE 帳號尚未綁定系統帳號，請先於系統設定完成綁定")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="帳號已停用")

    return user
