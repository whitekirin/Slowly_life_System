from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func

from backend.auth import get_current_user, has_any_permission
from backend.database import get_session
from backend.models import User, UserNotification, UserNotificationRead

# 不用 /notifications：那是前端 SPA 的頁面路由，正式環境前後端同一個 origin，會撞到。
router = APIRouter(prefix="/user_notifications", tags=["notifications"])


def is_admin_user(user: User) -> bool:
    # 與 system_log.py 的 admin 判斷一致：superuser 或權限含 admin（"all" 也算）
    return has_any_permission(user, ["admin"])


def notify_admins(session: Session, title: str, content: str, notification_type: str = "system", link: str | None = None) -> int:
    """發一則站內通知給每個啟用中的 admin 帳號。只 add 不 commit，由呼叫端決定 commit 時機，
    讓通知和觸發它的資料變更（例如完成盤點）落在同一個交易裡。回傳收件人數。"""
    admins = [u for u in session.exec(select(User).where(User.is_active == True)).all() if is_admin_user(u)]  # noqa: E712
    for admin in admins:
        session.add(UserNotification(
            user_id=admin.id,
            title=title,
            content=content,
            notification_type=notification_type,
            link=link,
        ))
    return len(admins)


@router.get("/", response_model=List[UserNotificationRead])
def list_notifications(limit: int = 100, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return session.exec(
        select(UserNotification)
        .where(UserNotification.user_id == current_user.id)
        .order_by(UserNotification.created_at.desc())
        .limit(min(limit, 500))
    ).all()


@router.get("/unread-count")
def get_unread_count(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    count = session.exec(
        select(func.count()).select_from(UserNotification)
        .where(UserNotification.user_id == current_user.id, UserNotification.is_read == False)  # noqa: E712
    ).one()
    return {"count": count}


@router.post("/{notification_id}/read", response_model=UserNotificationRead)
def mark_read(notification_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    notification = session.get(UserNotification, notification_id)
    if not notification or notification.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now()
        session.add(notification)
        session.commit()
        session.refresh(notification)
    return notification


@router.post("/read-all")
def mark_all_read(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    unread = session.exec(
        select(UserNotification)
        .where(UserNotification.user_id == current_user.id, UserNotification.is_read == False)  # noqa: E712
    ).all()
    now = datetime.now()
    for n in unread:
        n.is_read = True
        n.read_at = now
        session.add(n)
    session.commit()
    return {"updated": len(unread)}
