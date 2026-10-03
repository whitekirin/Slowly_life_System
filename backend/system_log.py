from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from sqlmodel import Session, select, desc, func
from typing import List, Optional
from datetime import datetime, timedelta
import csv
import io
from fastapi.responses import StreamingResponse
from sqlalchemy import or_

from backend.database import get_session
from backend.models import SystemLog, User
from backend.auth import get_current_user, has_any_permission
from backend.audit import (
    ACTION_LABELS, RESOURCE_LABELS, STATUS_LABELS,
    action_label, resource_label, status_label, translate_legacy_details,
)

router = APIRouter(prefix="/system-logs", tags=["System Logs"])

def create_log(
    session: Session,
    username: str,
    action: str,
    resource: str,
    details: Optional[str] = None,
    status: str = "success"
):
    """
    Helper function to create a system log entry.
    """
    try:
        log = SystemLog(
            username=username,
            action=action,
            resource=resource,
            details=details,
            status=status
        )
        session.add(log)
        session.commit()
        session.refresh(log)
        return log
    except Exception as e:
        # Prevent log creation failure from crashing the main application flow
        print(f"Failed to create system log: {e}")
        return None


def _codes_matching(labels: dict, keyword: str) -> list[str]:
    """中文關鍵字（例如「新增」「採購單」）對回資料庫裡存的代碼。"""
    return [code for code, label in labels.items() if keyword in label]


def _filtered_query(start_date: Optional[datetime], end_date: Optional[datetime], keyword: Optional[str]):
    # 改版前的 middleware 連每次查看頁面（GET）都記成 query，那些不是操作，不列出
    query = select(SystemLog).where(SystemLog.action != "query")

    if start_date:
        query = query.where(SystemLog.timestamp >= start_date)
    if end_date:
        query = query.where(SystemLog.timestamp <= end_date)

    if keyword:
        conditions = [
            SystemLog.username.contains(keyword),
            SystemLog.action.contains(keyword),
            SystemLog.resource.contains(keyword),
            SystemLog.details.contains(keyword),
        ]
        action_codes = _codes_matching(ACTION_LABELS, keyword)
        resource_codes = _codes_matching(RESOURCE_LABELS, keyword)
        status_codes = _codes_matching(STATUS_LABELS, keyword)
        if action_codes:
            conditions.append(SystemLog.action.in_(action_codes))
        if resource_codes:
            conditions.append(SystemLog.resource.in_(resource_codes))
        if status_codes:
            conditions.append(SystemLog.status.in_(status_codes))
        query = query.where(or_(*conditions))
    return query


def _display_names(session: Session, usernames: set[str]) -> dict[str, str]:
    if not usernames:
        return {}
    users = session.exec(select(User).where(User.username.in_(usernames))).all()
    return {u.username: u.full_name for u in users if u.full_name}


def _operator(username: str, names: dict[str, str]) -> str:
    if username in (None, "", "anonymous"):
        return "訪客（未登入）"
    full_name = names.get(username)
    return f"{full_name}（{username}）" if full_name else username


def _to_display(log: SystemLog, names: dict[str, str]) -> dict:
    return {
        "id": log.id,
        "timestamp": log.timestamp,
        "username": log.username,
        "operator": _operator(log.username, names),
        "action": log.action,
        "action_label": action_label(log.action),
        "resource": log.resource,
        "resource_label": resource_label(log.resource),
        "status": log.status,
        "status_label": status_label(log.status),
        "details": translate_legacy_details(log.details, log.action, log.resource, log.status),
    }


@router.get("/", response_model=dict)
def get_logs(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    keyword: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Admin only check - strictly enforce admin access
    if not has_any_permission(current_user, ["view_system_logs", "admin"]):
         raise HTTPException(status_code=403, detail="Not authorized")

    query = _filtered_query(start_date, end_date, keyword)

    # Pagination - optimized count
    count_statement = select(func.count()).select_from(query.subquery())
    total = session.exec(count_statement).one()

    # Sort by timestamp desc
    query = query.order_by(desc(SystemLog.timestamp))

    # Apply pagination
    logs = session.exec(query.offset((page - 1) * limit).limit(limit)).all()
    names = _display_names(session, {log.username for log in logs})

    return {
        "items": [_to_display(log, names) for log in logs],
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit
    }

@router.get("/export")
def export_logs(
    request: Request,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    keyword: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Admin only check
    if not has_any_permission(current_user, ["view_system_logs", "admin"]):
         raise HTTPException(status_code=403, detail="Not authorized")

    # Log the export action
    create_log(session, current_user.username, "export", "system_logs", "匯出系統日誌", "success")

    query = _filtered_query(start_date, end_date, keyword).order_by(desc(SystemLog.timestamp))
    logs = session.exec(query).all()
    names = _display_names(session, {log.username for log in logs})

    # Create CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["編號", "時間", "操作人", "動作", "功能", "結果", "詳情"])

    for log in logs:
        row = _to_display(log, names)
        writer.writerow([
            row["id"],
            log.timestamp.strftime("%Y-%m-%d %H:%M:%S") if log.timestamp else "",
            row["operator"],
            row["action_label"],
            row["resource_label"],
            row["status_label"],
            row["details"],
        ])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")), # utf-8-sig for Excel compatibility
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=system_logs.csv"}
    )
