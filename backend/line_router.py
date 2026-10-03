import base64
import secrets
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models import User, UserLineBinding, LineOAuthState
from backend.auth import get_current_user, require_permissions
from backend.line_actions import LINE_ACTIONS, group_actions, list_available_actions
from backend.line_menu_config import (
    ACTION_LABEL_MAX, GROUP_LABEL_MAX, PALETTE, SUBTITLE_MAX,
    default_config, load_config, normalize_config, palette_of, reset_config, resolve_menu, save_config,
)
from backend.line_richmenu import build_rich_menu, sync_all_rich_menus, sync_user_rich_menu, unlink_rich_menu, user_tiles
from backend.line_utils import build_line_login_url, exchange_code_for_token, get_line_profile

router = APIRouter(prefix="/line", tags=["line"])

STATE_TTL_MINUTES = 10


@router.post("/bind/start")
def start_line_bind(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    # Clear any previous unfinished attempts for this user before issuing a new one.
    old_states = session.exec(select(LineOAuthState).where(LineOAuthState.user_id == current_user.id)).all()
    for old_state in old_states:
        session.delete(old_state)

    state = secrets.token_urlsafe(24)
    session.add(LineOAuthState(state=state, user_id=current_user.id))
    session.commit()

    return {"authorize_url": build_line_login_url(state)}


@router.get("/callback", response_class=HTMLResponse)
def line_callback(code: str, state: str, session: Session = Depends(get_session)):
    def render(message: str) -> str:
        return f"""
        <html><head><meta charset="utf-8"><title>LINE 綁定</title></head>
        <body style="font-family: sans-serif; text-align: center; padding-top: 80px;">
            <p>{message}</p>
            <p>請關閉此視窗。</p>
        </body></html>
        """

    oauth_state = session.get(LineOAuthState, state)
    if not oauth_state:
        return HTMLResponse(render("綁定連結無效或已過期，請回到系統重新綁定。"), status_code=400)

    if datetime.utcnow() - oauth_state.created_at > timedelta(minutes=STATE_TTL_MINUTES):
        session.delete(oauth_state)
        session.commit()
        return HTMLResponse(render("綁定連結已過期，請回到系統重新綁定。"), status_code=400)

    user_id = oauth_state.user_id
    session.delete(oauth_state)
    session.commit()

    try:
        token_data = exchange_code_for_token(code)
        profile = get_line_profile(token_data["access_token"])
    except Exception:
        return HTMLResponse(render("向 LINE 驗證身分時發生錯誤，請回到系統重新綁定。"), status_code=502)

    line_user_id = profile["userId"]
    display_name = profile.get("displayName")

    # If this LINE account is already bound to a different user, move the binding.
    existing = session.exec(select(UserLineBinding).where(UserLineBinding.line_user_id == line_user_id)).first()
    if existing and existing.user_id != user_id:
        session.delete(existing)
        session.commit()

    binding = session.get(UserLineBinding, user_id)
    previous_line_user_id = binding.line_user_id if binding else None
    if binding:
        binding.line_user_id = line_user_id
        binding.line_display_name = display_name
        binding.line_bound_at = datetime.utcnow()
    else:
        binding = UserLineBinding(
            user_id=user_id,
            line_user_id=line_user_id,
            line_display_name=display_name,
            line_bound_at=datetime.utcnow(),
        )
    session.add(binding)
    session.commit()

    # 換上依權限產生的圖文選單；LINE API 失敗只記 log，不影響綁定結果
    if previous_line_user_id and previous_line_user_id != line_user_id:
        unlink_rich_menu(previous_line_user_id)  # 換綁到別的 LINE 帳號，舊帳號改回預設選單
    user = session.get(User, user_id)
    if user:
        sync_user_rich_menu(session, user, line_user_id)

    return HTMLResponse(render(f"LINE 帳號綁定成功！（{display_name or ''}）"))


@router.get("/bind/status")
def get_line_bind_status(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    binding = session.get(UserLineBinding, current_user.id)
    if not binding:
        return {"bound": False}
    return {
        "bound": True,
        "line_display_name": binding.line_display_name,
        "line_bound_at": binding.line_bound_at,
    }


@router.delete("/bind")
def unbind_line(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    binding = session.get(UserLineBinding, current_user.id)
    if binding:
        line_user_id = binding.line_user_id
        session.delete(binding)
        session.commit()
        unlink_rich_menu(line_user_id)
    return {"bound": False}


@router.post("/richmenu/sync")
def sync_rich_menus(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    """重設頻道預設選單並依目前權限重新同步所有綁定帳號的 LINE 圖文選單。"""
    return sync_all_rich_menus(session)


# ---- LINE 介面設定（frontend/src/pages/LineMenuSettings.tsx）----
# 調的是外觀與排列；誰看得到哪個功能一律照系統權限（line_actions.py 的 required_permissions）。

def _sync_all_in_background(bind) -> None:
    with Session(bind) as session:
        sync_all_rich_menus(session)


@router.get("/menu-config")
def get_menu_config(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    bound_ids = set(session.exec(select(UserLineBinding.user_id)).all())
    users = session.exec(select(User).where(User.is_active == True).order_by(User.username)).all()  # noqa: E712
    return {
        "config": load_config(session),
        "defaults": default_config(),
        "palette": PALETTE,
        "limits": {"group_label": GROUP_LABEL_MAX, "subtitle": SUBTITLE_MAX, "action_label": ACTION_LABEL_MAX},
        "actions": [
            {
                "code": a.code, "default_label": a.label, "default_group": a.group, "liff_path": a.liff_path,
                "required_permissions": a.required_permissions, "allow_picker": a.allow_picker,
            }
            for a in LINE_ACTIONS.values()
        ],
        "preview_users": [
            {"id": u.id, "username": u.username, "full_name": u.full_name, "line_bound": u.id in bound_ids}
            for u in users
        ],
    }


@router.put("/menu-config")
def update_menu_config(
    background_tasks: BackgroundTasks,
    data: dict = Body(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    """存檔後在背景重新同步所有綁定帳號的圖文選單（換新圖、刪掉舊圖）。"""
    try:
        config = save_config(session, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    background_tasks.add_task(_sync_all_in_background, session.get_bind())
    return {"config": config}


@router.post("/menu-config/reset")
def reset_menu_config(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    config = reset_config(session)
    background_tasks.add_task(_sync_all_in_background, session.get_bind())
    return {"config": config}


class MenuPreviewRequest(BaseModel):
    config: dict[str, Any]
    user_id: Optional[int] = None  # 不給 = 不看權限，顯示所有開啟的功能


@router.post("/menu-config/preview")
def preview_menu_config(
    body: MenuPreviewRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    """用還沒存的設定畫出圖文選單，並列出（某位使用者）會看到的分組與功能。"""
    try:
        menu = resolve_menu(normalize_config(body.config, strict=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if body.user_id is None:
        grouped = group_actions(menu.actions, menu.groups)
        tiles = [g.code for g, _ in grouped][:7] + ["all"] if grouped else []
    else:
        user = session.get(User, body.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="找不到這位使用者")
        grouped = group_actions(list_available_actions(user, session, menu.actions), menu.groups) if user.is_active else []
        tiles = user_tiles(session, user, menu) if user.is_active else []

    image = None
    if tiles:
        try:
            _, png = build_rich_menu(tiles, menu)
        except RuntimeError as e:  # 主機沒裝中文字型
            raise HTTPException(status_code=500, detail=str(e))
        image = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return {
        "image": image,
        "tiles": tiles,
        "groups": [
            {
                "code": g.code, "label": g.label, "subtitle": g.subtitle, "colors": palette_of(g.color),
                "actions": [{"code": a.code, "label": a.label} for a in actions],
            }
            for g, actions in grouped
        ],
    }
