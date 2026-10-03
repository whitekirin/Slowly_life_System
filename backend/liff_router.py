from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from backend.auth import create_access_token
from backend.database import get_session
from backend.liff_auth import get_current_line_user
from backend.line_actions import group_actions, list_available_actions
from backend.line_menu_config import menu_for, palette_of
from backend.models import User, UserRead
from backend.system_log import create_log

router = APIRouter(prefix="/liff", tags=["liff"])

LIFF_SESSION_MINUTES = 8 * 60


@router.get("/me")
def liff_me(current_user: User = Depends(get_current_line_user)):
    return {"username": current_user.username, "full_name": current_user.full_name}


@router.get("/actions")
def liff_actions(current_user: User = Depends(get_current_line_user), session: Session = Depends(get_session)):
    menu = menu_for(session)
    return [
        {
            "code": a.code, "label": a.label, "liff_path": a.liff_path,
            "group": g.code, "group_label": g.label, "group_subtitle": g.subtitle, "group_colors": palette_of(g.color),
        }
        for g, actions in group_actions(list_available_actions(current_user, session, menu.actions), menu.groups)
        for a in actions
    ]


@router.post("/session")
def liff_session(current_user: User = Depends(get_current_line_user), session: Session = Depends(get_session)):
    """用 LINE 身分（已綁定、啟用中的帳號）換員工系統的 access token，讓 LIFF 直接開後台頁面
    （frontend/src/pages/liff/LiffGo.tsx）。權限照樣由各 endpoint 檢查，跟密碼登入拿到的 token 一樣；
    有效期縮短，因為它存在 LINE 內建瀏覽器裡。"""
    if current_user.force_password_change:
        # 密碼登入時會先強制改密碼；LINE 這條路不能繞過去
        raise HTTPException(status_code=403, detail="請先用電腦登入系統變更密碼，再從 LINE 開啟")
    access_token = create_access_token(
        data={"sub": current_user.username}, expires_delta=timedelta(minutes=LIFF_SESSION_MINUTES),
    )
    create_log(session, current_user.username, "login", "auth", "透過 LINE 開啟系統", "success")
    return {"access_token": access_token, "token_type": "bearer", "user": UserRead.model_validate(current_user)}
