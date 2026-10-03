"""補驗收單：採購單驗收短收後，從「進貨驗收 → 驗收紀錄」按鈕建立，補收剩下的數量。

剩餘短收數量 = 原採購單各品項短收（quantity - received_quantity）
             - 待驗收補驗收單的待補數量（已經排進補驗收，不能重複建立）
             - 已完成補驗收單的實收數量（補驗收又短收的部分仍算未補齊，可再建一張）
"""
from collections import defaultdict
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from backend.auth import has_any_permission, require_permissions
from backend.database import get_session
from backend.models import (
    InventoryLog,
    Product,
    PurchaseOrder,
    SupplementaryReceiving,
    SupplementaryReceivingCreate,
    SupplementaryReceivingItem,
    SupplementaryReceivingRead,
    SupplementaryReceivingReceive,
    User,
)
from backend.notifications import notify_admins
from backend.supplier_rating import apply_supplementary_shortage

router = APIRouter(prefix="/supplementary_receivings", tags=["supplementary_receivings"])

# 補驗收單有自己的權限：查看、新增（建立補驗收單）、修改（補驗收入庫）
VIEW_PERMISSIONS = ["view_supplementary_receivings"]
CREATE_PERMISSIONS = ["create_supplementary_receivings"]
EDIT_PERMISSIONS = ["edit_supplementary_receivings"]


def ensure_can_create_supplementary(user: User, items) -> None:
    """驗收時勾了「建立補驗收單」就等於新增補驗收單，要有補驗收單的新增權限。"""
    if any(getattr(i, "create_supplementary", False) for i in items or []) and not has_any_permission(user, CREATE_PERMISSIONS):
        raise HTTPException(status_code=403, detail="沒有新增補驗收單的權限，請取消勾選「建立補驗收單」")


def _user_label(user: User) -> str:
    return user.full_name or user.username


def _product_label(product: Product | None, product_id: int) -> str:
    return f"{product.name}（{product.sku}）" if product else f"商品 #{product_id}"


def remaining_shortages(session: Session, po: PurchaseOrder) -> dict[int, int]:
    """回傳 {product_id: 還沒補齊的數量}，只含 > 0 的品項。"""
    remaining: dict[int, int] = defaultdict(int)
    for item in po.items:
        if item.received_quantity is not None and item.received_quantity < item.quantity:
            remaining[item.product_id] += item.quantity - item.received_quantity

    srs = session.exec(select(SupplementaryReceiving).where(SupplementaryReceiving.po_id == po.id)).all()
    for sr in srs:
        for item in sr.items:
            if sr.status == "received":
                remaining[item.product_id] -= item.received_quantity or 0
            else:
                remaining[item.product_id] -= item.quantity
    return {pid: qty for pid, qty in remaining.items() if qty > 0}


def create_supplementary(session: Session, po: PurchaseOrder, user: User, product_ids: set[int] | None = None) -> SupplementaryReceiving | None:
    """依剩餘短收建立補驗收單並通知 admin（只 add/flush 不 commit，由呼叫端 commit）。
    product_ids 給定時只補這些品項（驗收時勾選「建立補驗收單」的品項）；沒有可補的就回傳 None。"""
    remaining = remaining_shortages(session, po)
    if product_ids is not None:
        remaining = {pid: qty for pid, qty in remaining.items() if pid in product_ids}
    if not remaining:
        return None

    sr = SupplementaryReceiving(po_id=po.id, supplier_name=po.supplier_name, created_by_name=_user_label(user))
    session.add(sr)
    session.flush()  # 取得 sr.id 給通知標題用
    lines = []
    for product_id, qty in sorted(remaining.items()):
        session.add(SupplementaryReceivingItem(supplementary_receiving_id=sr.id, product_id=product_id, quantity=qty))
        lines.append(f"{_product_label(session.get(Product, product_id), product_id)}：待補 {qty}")

    notify_admins(
        session,
        title=f"補驗收單建立通知：SR-{sr.id}（PO-{po.id}，{po.supplier_name}）",
        content=f"建立人：{sr.created_by_name}\n共 {len(lines)} 項商品待補驗收：\n" + "\n".join(lines),
        notification_type="supplementary_receiving",
        link="/supplementary-receiving",
    )
    return sr


@router.get("/outstanding")
def list_outstanding(session: Session = Depends(get_session), current_user: User = Depends(require_permissions(VIEW_PERMISSIONS))):
    """已驗收、且還有短收沒補齊的採購單，給驗收紀錄決定要不要顯示「建立補驗收單」。"""
    pos = session.exec(select(PurchaseOrder).where(PurchaseOrder.status == "received", PurchaseOrder.void_status.is_(None))).all()
    result = []
    for po in pos:
        remaining = remaining_shortages(session, po)
        if remaining:
            result.append({
                "po_id": po.id,
                "items": [{"product_id": pid, "remaining_quantity": qty} for pid, qty in sorted(remaining.items())],
            })
    return result


@router.get("/", response_model=List[SupplementaryReceivingRead])
def list_supplementary_receivings(session: Session = Depends(get_session), current_user: User = Depends(require_permissions(VIEW_PERMISSIONS))):
    return session.exec(select(SupplementaryReceiving).order_by(SupplementaryReceiving.id.desc())).all()


@router.post("/", response_model=SupplementaryReceivingRead)
def create_supplementary_receiving(data: SupplementaryReceivingCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(CREATE_PERMISSIONS))):
    po = session.get(PurchaseOrder, data.po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    if po.status != "received":
        raise HTTPException(status_code=400, detail="採購單尚未驗收入庫，不能建立補驗收單")
    if po.void_status:
        raise HTTPException(status_code=400, detail="報廢審核中或已報廢的採購單不能建立補驗收單")

    sr = create_supplementary(session, po, current_user)
    if sr is None:
        raise HTTPException(status_code=400, detail=f"PO-{po.id} 沒有需要補驗收的短收品項")
    session.commit()
    session.refresh(sr)
    return sr


@router.post("/{sr_id}/receive", response_model=SupplementaryReceivingRead)
def receive_supplementary_receiving(sr_id: int, data: SupplementaryReceivingReceive, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(EDIT_PERMISSIONS))):
    sr = session.get(SupplementaryReceiving, sr_id)
    if not sr:
        raise HTTPException(status_code=404, detail="Supplementary Receiving not found")
    if sr.status == "received":
        raise HTTPException(status_code=400, detail="此補驗收單已完成驗收")

    # 所有檢查都在任何 mutation 之前，被拒絕的請求不留部分寫入
    ensure_can_create_supplementary(current_user, data.items)
    items_by_id = {item.id: item for item in sr.items}
    updates = {u.id: u for u in data.items}
    if set(updates) != set(items_by_id):
        raise HTTPException(status_code=400, detail="驗收資料必須包含補驗收單的每一個品項")
    missing_reason = []
    for item_id, u in updates.items():
        item = items_by_id[item_id]
        if u.received_quantity < 0 or u.received_quantity > item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"{_product_label(item.product, item.product_id)} 實際驗收數量（{u.received_quantity}）必須介於 0 到待補數量（{item.quantity}）",
            )
        if u.received_quantity < item.quantity and not (u.shortage_reason and u.shortage_reason.strip()):
            missing_reason.append(item.product.name if item.product else f"商品 #{item.product_id}")
    if missing_reason:
        raise HTTPException(status_code=400, detail=f"以下品項實際驗收少於待補數量，請先填寫短收原因：{'、'.join(missing_reason)}")

    shortages = []
    for item_id, u in updates.items():
        item = items_by_id[item_id]
        item.received_quantity = u.received_quantity
        item.note = u.note
        item.shortage_reason = u.shortage_reason.strip() if u.received_quantity < item.quantity else None
        item.receiving_image = u.receiving_image
        item.receiving_video = u.receiving_video
        session.add(item)

        if u.received_quantity > 0:
            product = session.get(Product, item.product_id)
            if product:
                product.stock_quantity += u.received_quantity
                if product.first_received_at is None:
                    product.first_received_at = datetime.now()
                session.add(product)
                # change_type 沿用 purchase：這是同一張採購單的進貨，只是分批到
                session.add(InventoryLog(
                    product_id=product.id,
                    change_amount=u.received_quantity,
                    change_type="purchase",
                    reference_id=f"SR-{sr.id}",
                ))
        if u.received_quantity < item.quantity:
            shortages.append(item)

    sr.status = "received"
    sr.received_at = datetime.now()
    sr.received_by_name = _user_label(current_user)
    session.add(sr)

    if shortages:
        lines = [
            f"【短收】{_product_label(i.product, i.product_id)}：待補 {i.quantity} → 實收 {i.received_quantity}（{i.received_quantity - i.quantity:+d}），原因：{i.shortage_reason}"
            for i in shortages
        ]
        notify_admins(
            session,
            title=f"補驗收短收通知：SR-{sr.id}（PO-{sr.po_id}，{sr.supplier_name}）",
            content=f"驗收人：{sr.received_by_name}\n共 {len(shortages)} 項商品仍未補齊：\n" + "\n".join(lines),
            notification_type="receiving_shortage",
            link="/supplementary-receiving",
        )
        apply_supplementary_shortage(session, sr, shortages, sr.received_by_name)

    # 仍短收且勾選「建立補驗收單」的品項，直接再開一張補驗收單
    follow_up = {items_by_id[i].product_id for i, u in updates.items() if u.create_supplementary and u.received_quantity < items_by_id[i].quantity}
    if follow_up:
        create_supplementary(session, session.get(PurchaseOrder, sr.po_id), current_user, follow_up)

    session.commit()
    session.refresh(sr)
    return sr
