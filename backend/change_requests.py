"""簽呈：送給該功能有核准權限（approve_X）的人審核。兩種動作：

- edit（修改已鎖定的單）：核准後給申請人一個臨時權限，只限那張單，由核准人決定有效時數（最長 24 小時）與可用次數。
- void（報廢）：單據不能刪除只能報廢。送出時單據進入「報廢審核中」凍結，核准就執行報廢（backend/voiding.py），
  駁回或取消就恢復。
送出、核准、駁回、取消，以及每一次用臨時權限（或核准權限直接）修改，都寫進系統日誌。

要讓其他功能也走簽呈：在 RESOURCES 加一筆，修改端點呼叫 authorize_locked_change()。
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from backend.auth import get_current_active_user, has_any_permission
from backend.database import get_session
from backend.models import (
    ChangeRequest, ChangeRequestApprove, ChangeRequestCreate, ChangeRequestRead, ChangeRequestReject,
    PurchaseOrder, ReturnOrder, SalesOrder, SystemLog, User, UserNotification,
)
from backend.voiding import (
    po_void_blocker, ro_void_blocker, so_void_blocker, void_purchase_order, void_return_order, void_sales_order,
)

router = APIRouter(prefix="/change_requests", tags=["change_requests"])

MAX_VALID_HOURS = 24
ACTION_LABELS = {"edit": "修改", "delete": "刪除", "void": "報廢"}


@dataclass(frozen=True)
class ResourceSpec:
    label: str               # 功能名稱，例如「採購單」
    manage_permission: str   # 可以申請的人（該功能的修改／刪除權限）
    approve_permission: str  # 可以核准的人；也可以不經簽呈直接修改鎖定的單
    log_resource: str        # 系統日誌的 resource 欄
    link: str                # 前端頁面
    load: Callable[[Session, int], Optional[object]]
    is_locked: Callable[[object], bool]
    locked_hint: str
    describe: Callable[[object], str]
    actions: tuple = ("edit",)  # 這個功能可以申請的簽呈動作
    void_blocker: Optional[Callable[[Session, object, bool], Optional[str]]] = None  # 不能報廢的原因
    void: Optional[Callable[[Session, object, User, Optional[Request]], None]] = None  # 執行報廢


RESOURCES = {
    "purchase_order": ResourceSpec(
        label="採購單",
        manage_permission="edit_purchase_orders",
        approve_permission="approve_purchase_orders",
        log_resource="purchase_orders",
        link="/purchase-orders",
        load=lambda session, rid: session.get(PurchaseOrder, rid),
        is_locked=lambda po: po.status == "completed",
        locked_hint="只有「已完成（待驗收）」的採購單需要簽呈",
        describe=lambda po: f"PO-{po.id}（{po.supplier_name}）",
        actions=("edit", "void"),
        void_blocker=po_void_blocker,
        void=void_purchase_order,
    ),
    "sales_order": ResourceSpec(
        label="出貨單",
        manage_permission="edit_shipping",
        approve_permission="approve_shipping",
        log_resource="sales_orders",
        link="/shipping",
        load=lambda session, rid: session.get(SalesOrder, rid),
        is_locked=lambda so: False,
        locked_hint="出貨單只能申請報廢",
        describe=lambda so: f"{so.order_number or f'SO-{so.id}'}（客戶：{so.customer_id}）",
        actions=("void",),
        void_blocker=so_void_blocker,
        void=void_sales_order,
    ),
    "return_order": ResourceSpec(
        label="退貨單",
        manage_permission="edit_returns",
        approve_permission="approve_returns",
        log_resource="return_orders",
        link="/returns",
        load=lambda session, rid: session.get(ReturnOrder, rid),
        is_locked=lambda ro: False,
        locked_hint="退貨單只能申請報廢",
        describe=lambda ro: f"{ro.return_number or f'RO-{ro.id}'}（客戶：{ro.customer_id or '-'}）",
        actions=("void",),
        void_blocker=ro_void_blocker,
        void=void_return_order,
    ),
}


def _spec(resource_type: str) -> ResourceSpec:
    spec = RESOURCES.get(resource_type)
    if not spec:
        raise HTTPException(status_code=400, detail=f"不支援的簽呈類型：{resource_type}")
    return spec


def _display_name(user: User) -> str:
    return user.full_name or user.username


def add_log(session: Session, user: User, request: Optional[Request], action: str, resource: str, details: str):
    """只 add 不 commit：日誌和觸發它的資料變更落在同一個交易，要嘛一起成功要嘛一起失敗。"""
    session.add(SystemLog(
        username=user.username,
        action=action, resource=resource, details=details, status="success",
    ))


def effective_status(cr: ChangeRequest, now: Optional[datetime] = None) -> str:
    if cr.status != "approved":
        return cr.status
    if cr.action == "void":
        return "voided"  # 報廢核准當下就執行了，沒有臨時權限
    if cr.used_count >= cr.max_uses:
        return "used_up"
    if cr.expires_at and (now or datetime.now()) >= cr.expires_at:
        return "expired"
    return "active"


def _to_read(session: Session, cr: ChangeRequest) -> ChangeRequestRead:
    spec = RESOURCES.get(cr.resource_type)
    target = spec.load(session, cr.resource_id) if spec else None
    if spec and target:
        label = f"{spec.label} {spec.describe(target)}"
    else:
        label = f"{spec.label if spec else cr.resource_type} #{cr.resource_id}（已不存在）"
    return ChangeRequestRead(
        **cr.model_dump(),
        effective_status=effective_status(cr),
        resource_label=label,
        resource_link=spec.link if spec else None,
    )


def _approvers(session: Session, spec: ResourceSpec, exclude_user_id: int) -> List[User]:
    users = session.exec(select(User).where(User.is_active == True)).all()  # noqa: E712
    return [u for u in users if u.id != exclude_user_id and has_any_permission(u, [spec.approve_permission])]


def authorize_locked_change(
    session: Session, user: User, request: Optional[Request],
    resource_type: str, resource_id: int, action: str, summary: str,
):
    """修改／刪除一張已鎖定的單之前呼叫：核准權限直接放行；否則扣一次有效的臨時權限，都沒有就 403。
    只 add 不 commit，扣次數與日誌跟著呼叫端的修改一起 commit——修改失敗就不會白白扣掉一次。"""
    spec = _spec(resource_type)
    verb = ACTION_LABELS[action]
    log_action = "update" if action == "edit" else "delete"
    if has_any_permission(user, [spec.approve_permission]):
        add_log(session, user, request, log_action, spec.log_resource,
                f"以核准權限直接{verb}已鎖定的{spec.label} #{resource_id}：{summary}")
        return None

    now = datetime.now()
    candidates = session.exec(
        select(ChangeRequest).where(
            ChangeRequest.requester_id == user.id,
            ChangeRequest.resource_type == resource_type,
            ChangeRequest.resource_id == resource_id,
            ChangeRequest.action == action,
            ChangeRequest.status == "approved",
        ).order_by(ChangeRequest.expires_at)
    ).all()
    grant = next((cr for cr in candidates if effective_status(cr, now) == "active"), None)
    if not grant:
        raise HTTPException(
            status_code=403,
            detail=f"已鎖定的{spec.label}需先送簽呈並經核准，才能{verb}（請按「申請修改」）",
        )
    grant.used_count += 1
    session.add(grant)
    add_log(session, user, request, log_action, spec.log_resource,
            f"使用簽呈 #{grant.id} 的臨時權限{verb}{spec.label} #{resource_id}"
            f"（第 {grant.used_count}/{grant.max_uses} 次，核准人：{grant.approver_name}）：{summary}")
    return grant


@router.post("/", response_model=ChangeRequestRead)
def create_change_request(
    data: ChangeRequestCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    spec = _spec(data.resource_type)
    if data.action not in spec.actions:
        allowed = "、".join(f"{ACTION_LABELS[a]}（{a}）" for a in spec.actions)
        raise HTTPException(status_code=400, detail=f"{spec.label}的簽呈只能申請{allowed}")
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="請填寫簽呈事由")
    if not has_any_permission(current_user, [spec.manage_permission]):
        raise HTTPException(status_code=403, detail=f"沒有{spec.label}的修改／刪除權限，不能申請")
    verb = ACTION_LABELS[data.action]
    if has_any_permission(current_user, [spec.approve_permission]):
        raise HTTPException(status_code=400, detail=f"你有{spec.label}的核准權限，可以直接{verb}，不需送簽呈")
    target = spec.load(session, data.resource_id)
    if not target:
        raise HTTPException(status_code=404, detail=f"{spec.label}不存在")
    if data.action == "void":
        blocker = spec.void_blocker(session, target, False)
        if blocker:
            raise HTTPException(status_code=400, detail=blocker)
    else:
        if getattr(target, "void_status", None):
            raise HTTPException(status_code=400, detail=f"此{spec.label}報廢審核中或已報廢，不能申請修改")
        if not spec.is_locked(target):
            raise HTTPException(status_code=400, detail=spec.locked_hint)

    existing = session.exec(select(ChangeRequest).where(
        ChangeRequest.requester_id == current_user.id,
        ChangeRequest.resource_type == data.resource_type,
        ChangeRequest.resource_id == data.resource_id,
        ChangeRequest.action == data.action,
        ChangeRequest.status.in_(["pending", "approved"]),
    )).all()
    if any(effective_status(cr) in ("pending", "active") for cr in existing):
        raise HTTPException(status_code=400, detail="這張單已有審核中或仍有效的同類簽呈")

    cr = ChangeRequest(
        resource_type=data.resource_type, resource_id=data.resource_id, action=data.action,
        reason=reason, attachment_url=data.attachment_url or None,
        requester_id=current_user.id, requester_name=_display_name(current_user),
    )
    session.add(cr)
    session.flush()
    if data.action == "void":
        # 送出報廢簽呈就凍結這張單，頁面上顯示「報廢審核中」，核准才真的報廢
        target.void_status = "pending"
        target.void_reason = reason
        target.void_requested_by = cr.requester_name
        session.add(target)

    target_label = f"{spec.label} {spec.describe(target)}"
    for approver in _approvers(session, spec, current_user.id):
        session.add(UserNotification(
            user_id=approver.id,
            title=f"簽呈待核准：{verb}{target_label}",
            content=f"申請人：{cr.requester_name}\n事由：{reason}",
            notification_type="change_request",
            link="/change-requests",
        ))
    add_log(session, current_user, request, "submit", "change_requests",
            f"送出簽呈 #{cr.id}：申請{verb}{target_label}，事由：{reason}"
            + (f"，附件：{cr.attachment_url}" if cr.attachment_url else ""))
    session.commit()
    session.refresh(cr)
    return _to_read(session, cr)


@router.get("/mine", response_model=List[ChangeRequestRead])
def list_my_change_requests(
    resource_type: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    query = select(ChangeRequest).where(ChangeRequest.requester_id == current_user.id)
    if resource_type:
        query = query.where(ChangeRequest.resource_type == resource_type)
    rows = session.exec(query.order_by(ChangeRequest.created_at.desc())).all()
    return [_to_read(session, cr) for cr in rows]


@router.get("/for-approval", response_model=List[ChangeRequestRead])
def list_change_requests_for_approval(
    only_pending: bool = True,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    """回傳目前使用者有核准權限的功能的簽呈（不含自己送的）。"""
    types = [t for t, spec in RESOURCES.items() if has_any_permission(current_user, [spec.approve_permission])]
    if not types:
        return []
    query = select(ChangeRequest).where(
        ChangeRequest.resource_type.in_(types),
        ChangeRequest.requester_id != current_user.id,
    )
    if only_pending:
        query = query.where(ChangeRequest.status == "pending")
    rows = session.exec(query.order_by(ChangeRequest.created_at.desc())).all()
    return [_to_read(session, cr) for cr in rows]


def _load_for_decision(session: Session, cr_id: int, user: User):
    cr = session.get(ChangeRequest, cr_id)
    if not cr:
        raise HTTPException(status_code=404, detail="簽呈不存在")
    spec = _spec(cr.resource_type)
    if not has_any_permission(user, [spec.approve_permission]):
        raise HTTPException(status_code=403, detail=f"沒有{spec.label}的核准權限")
    if cr.requester_id == user.id:
        raise HTTPException(status_code=403, detail="不能核准自己送出的簽呈")
    if cr.status != "pending":
        raise HTTPException(status_code=400, detail="這份簽呈已經處理過了")
    return cr, spec


@router.post("/{cr_id}/approve", response_model=ChangeRequestRead)
def approve_change_request(
    cr_id: int,
    data: ChangeRequestApprove,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    cr, spec = _load_for_decision(session, cr_id, current_user)
    if cr.action == "void":
        return _approve_void(session, cr, spec, data, request, current_user)
    if not 1 <= data.valid_hours <= MAX_VALID_HOURS:
        raise HTTPException(status_code=400, detail=f"有效時數必須在 1～{MAX_VALID_HOURS} 小時之間")
    if data.max_uses < 1:
        raise HTTPException(status_code=400, detail="可修改次數至少 1 次")
    target = spec.load(session, cr.resource_id)
    if not target or target.void_status or not spec.is_locked(target):
        raise HTTPException(status_code=400, detail=f"{spec.label}已不存在或已不是鎖定狀態，不需核准")

    now = datetime.now()
    cr.status = "approved"
    cr.approver_id = current_user.id
    cr.approver_name = _display_name(current_user)
    cr.decided_at = now
    cr.decision_note = (data.note or "").strip() or None
    cr.expires_at = now + timedelta(hours=data.valid_hours)
    cr.max_uses = data.max_uses
    session.add(cr)

    verb = ACTION_LABELS[cr.action]
    target_label = f"{spec.label} {spec.describe(target)}"
    expires_text = cr.expires_at.strftime("%Y-%m-%d %H:%M")
    session.add(UserNotification(
        user_id=cr.requester_id,
        title=f"簽呈已核准：{verb}{target_label}",
        content=f"核准人：{cr.approver_name}\n可{verb} {cr.max_uses} 次，{expires_text} 前有效"
                + (f"\n意見：{cr.decision_note}" if cr.decision_note else ""),
        notification_type="change_request",
        link=spec.link,
    ))
    add_log(session, current_user, request, "approve", "change_requests",
            f"核准簽呈 #{cr.id}（申請人：{cr.requester_name}）：臨時權限可{verb}{target_label} "
            f"{cr.max_uses} 次，有效 {data.valid_hours} 小時（至 {expires_text}）"
            + (f"，意見：{cr.decision_note}" if cr.decision_note else ""))
    session.commit()
    session.refresh(cr)
    return _to_read(session, cr)


def _approve_void(session: Session, cr: ChangeRequest, spec: ResourceSpec, data: ChangeRequestApprove,
                  request: Request, current_user: User) -> ChangeRequestRead:
    """核准報廢簽呈：當下執行報廢（沖回庫存、記帳），失敗（例如庫存不夠扣回）就整個不動、簽呈維持審核中。"""
    target = spec.load(session, cr.resource_id)
    if not target:
        raise HTTPException(status_code=400, detail=f"{spec.label}已不存在")
    spec.void(session, target, current_user, request)

    now = datetime.now()
    cr.status = "approved"
    cr.approver_id = current_user.id
    cr.approver_name = _display_name(current_user)
    cr.decided_at = now
    cr.decision_note = (data.note or "").strip() or None
    cr.expires_at = now
    cr.max_uses = 1
    cr.used_count = 1
    session.add(cr)

    target_label = f"{spec.label} {spec.describe(target)}"
    session.add(UserNotification(
        user_id=cr.requester_id,
        title=f"簽呈已核准：報廢{target_label}",
        content=f"核准人：{cr.approver_name}，單據已報廢" + (f"\n意見：{cr.decision_note}" if cr.decision_note else ""),
        notification_type="change_request",
        link=spec.link,
    ))
    add_log(session, current_user, request, "approve", "change_requests",
            f"核准簽呈 #{cr.id}（申請人：{cr.requester_name}）：報廢{target_label}，事由：{cr.reason}"
            + (f"，意見：{cr.decision_note}" if cr.decision_note else ""))
    session.commit()
    session.refresh(cr)
    return _to_read(session, cr)


def _release_void(session: Session, cr: ChangeRequest, spec: ResourceSpec):
    """報廢簽呈被駁回或取消：單據恢復可用。"""
    if cr.action != "void":
        return
    target = spec.load(session, cr.resource_id)
    if target and target.void_status == "pending":
        target.void_status = None
        target.void_reason = None
        target.void_requested_by = None
        session.add(target)


@router.post("/{cr_id}/reject", response_model=ChangeRequestRead)
def reject_change_request(
    cr_id: int,
    data: ChangeRequestReject,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    cr, spec = _load_for_decision(session, cr_id, current_user)
    cr.status = "rejected"
    cr.approver_id = current_user.id
    cr.approver_name = _display_name(current_user)
    cr.decided_at = datetime.now()
    cr.decision_note = (data.note or "").strip() or None
    session.add(cr)
    _release_void(session, cr, spec)

    verb = ACTION_LABELS[cr.action]
    session.add(UserNotification(
        user_id=cr.requester_id,
        title=f"簽呈已駁回：{verb}{spec.label} #{cr.resource_id}",
        content=f"駁回人：{cr.approver_name}" + (f"\n意見：{cr.decision_note}" if cr.decision_note else ""),
        notification_type="change_request",
        link="/change-requests",
    ))
    add_log(session, current_user, request, "reject", "change_requests",
            f"駁回簽呈 #{cr.id}（申請人：{cr.requester_name}，{verb}{spec.label} #{cr.resource_id}）"
            + (f"，意見：{cr.decision_note}" if cr.decision_note else ""))
    session.commit()
    session.refresh(cr)
    return _to_read(session, cr)


@router.post("/{cr_id}/cancel", response_model=ChangeRequestRead)
def cancel_change_request(
    cr_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
):
    cr = session.get(ChangeRequest, cr_id)
    if not cr or cr.requester_id != current_user.id:
        raise HTTPException(status_code=404, detail="簽呈不存在")
    if cr.status != "pending":
        raise HTTPException(status_code=400, detail="只能取消審核中的簽呈")
    cr.status = "cancelled"
    session.add(cr)
    spec = RESOURCES.get(cr.resource_type)
    if spec:
        _release_void(session, cr, spec)
    add_log(session, current_user, request, "cancel", "change_requests", f"取消簽呈 #{cr.id}")
    session.commit()
    session.refresh(cr)
    return _to_read(session, cr)
