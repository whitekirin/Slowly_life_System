"""報廢採購單／出貨單／退貨單。單據不能刪除，只能報廢；報廢的單永遠留在頁面上，不能再修改。

流程：有修改權限的人申請報廢（簽呈 action="void"，見 change_requests.py）→ 單據 void_status="pending"，
凍結不能修改、不能驗收／撿貨 → 有核准權限的主管核准才執行報廢（void_status="voided"），駁回或取消就恢復。
有核准權限的人可以直接報廢（寫系統日誌）。

執行報廢會把這張單造成的影響沖回去，原本的庫存異動與記帳都保留，另外記一筆反向的：
- 採購單：已入庫的扣回庫存（InventoryLog purchase_void），採購支出記一筆負數沖銷。
- 出貨單：建立時扣的庫存加回（InventoryLog sale_void）、會員回饋點數扣回，已出貨的銷售收入記一筆負數沖銷。
- 退貨單：已完成的退貨退款把加回的庫存扣掉（InventoryLog return_void），退款支出記一筆負數沖銷。
每個函式都只 add 不 commit，由呼叫端 commit。
"""
from collections import defaultdict
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import or_
from sqlmodel import Session, select

from backend.models import (
    InventoryLog, Member, PointTransactionLog, Product, PurchaseOrder, ReturnOrder, SalesOrder,
    SupplementaryReceiving, SystemLog, Transaction, User,
)

VOID_LABELS = {"pending": "報廢審核中", "voided": "已報廢"}


def _display_name(user: User) -> str:
    return user.full_name or user.username


def _log(session: Session, user: User, request: Optional[Request], action: str, resource: str, details: str):
    session.add(SystemLog(
        username=user.username,
        action=action, resource=resource, details=details, status="success",
    ))


def ensure_not_voided(order, label: str):
    """報廢審核中或已報廢的單不能再做任何修改（含驗收、撿貨、出貨）。"""
    if order.void_status:
        raise HTTPException(status_code=400, detail=f"此{label}{VOID_LABELS.get(order.void_status, '已報廢')}，不能再修改")


def po_void_blocker(session: Session, po: PurchaseOrder, allow_pending: bool = False) -> Optional[str]:
    """不能報廢的原因；allow_pending=True 用在核准報廢簽呈時（申請中的單正是要被報廢的）。"""
    if po.void_status and not (allow_pending and po.void_status == "pending"):
        return f"此採購單{VOID_LABELS.get(po.void_status, '已報廢')}"
    # 補驗收單的入庫量不在採購單上，報廢採購單沖不回去，庫存會對不上
    if session.exec(select(SupplementaryReceiving).where(SupplementaryReceiving.po_id == po.id)).first():
        return "此採購單已有補驗收單，不能報廢"
    return None


def so_void_blocker(session: Session, so: SalesOrder, allow_pending: bool = False) -> Optional[str]:
    if so.void_status and not (allow_pending and so.void_status == "pending"):
        return f"此出貨單{VOID_LABELS.get(so.void_status, '已報廢')}"
    # 退貨單已經把部分商品加回庫存、記了退款，再報廢出貨單會重複沖回（已報廢的退貨單已經沖回了，不算）
    if session.exec(select(ReturnOrder).where(
        ReturnOrder.order_id == so.id, or_(ReturnOrder.void_status.is_(None), ReturnOrder.void_status != "voided")
    )).first():
        return "此出貨單已有退貨單，不能報廢"
    return None


def ro_void_blocker(session: Session, ro: ReturnOrder, allow_pending: bool = False) -> Optional[str]:
    if ro.void_status and not (allow_pending and ro.void_status == "pending"):
        return f"此退貨單{VOID_LABELS.get(ro.void_status, '已報廢')}"
    return None


def _reverse_transactions(session: Session, user: User, request: Optional[Request], reference_id: str, label: str):
    """這張單自動記的帳（含財務後來的調整）依類別加總，各記一筆金額相反的沖銷。"""
    totals: dict[tuple[str, str], float] = defaultdict(float)
    for tx in session.exec(select(Transaction).where(Transaction.reference_id == reference_id)).all():
        totals[(tx.type, tx.category)] += tx.amount or 0
    for (tx_type, category), amount in totals.items():
        if abs(amount) < 0.005:
            continue
        session.add(Transaction(
            date=datetime.now(), type=tx_type, category=category, amount=-amount,
            description=f"{label} 報廢沖銷", reference_id=reference_id,
            created_by=_display_name(user), handled_by=_display_name(user),
        ))
        kind = "收入" if tx_type == "income" else "支出"
        _log(session, user, request, "auto_transaction", "transactions",
             f"自動記帳：{label} 報廢沖銷 {kind} {category} {-amount:g}，來源 {reference_id}")


def _mark_voided(order, user: User):
    order.void_status = "voided"
    order.voided_by = _display_name(user)
    order.voided_at = datetime.now()


def void_purchase_order(session: Session, po: PurchaseOrder, user: User, request: Optional[Request]):
    blocker = po_void_blocker(session, po, allow_pending=True)
    if blocker:
        raise HTTPException(status_code=400, detail=blocker)

    label = f"PO-{po.id}"
    if po.status == "received":
        for item in po.items:
            qty = item.received_quantity if item.received_quantity is not None else item.quantity
            product = session.get(Product, item.product_id)
            if not product or not qty:
                continue
            if product.stock_quantity < qty:
                raise HTTPException(
                    status_code=400,
                    detail=f"「{product.name}」目前庫存 {product.stock_quantity}，不夠扣回這張採購單入庫的 {qty} 件，"
                           "商品可能已經賣出；請先用庫存盤點或退貨處理，不能直接報廢",
                )
            product.stock_quantity -= qty
            session.add(product)
            session.add(InventoryLog(product_id=product.id, change_amount=-qty, change_type="purchase_void", reference_id=label))
        _reverse_transactions(session, user, request, label, label)

    _mark_voided(po, user)
    session.add(po)


def void_sales_order(session: Session, so: SalesOrder, user: User, request: Optional[Request]):
    blocker = so_void_blocker(session, so, allow_pending=True)
    if blocker:
        raise HTTPException(status_code=400, detail=blocker)

    label = so.order_number or f"SO-{so.id}"
    # 出貨單建立時就扣了庫存（不論狀態），報廢一律加回
    for item in so.items:
        product = session.get(Product, item.product_id)
        if product:
            product.stock_quantity += item.quantity
            session.add(product)
            session.add(InventoryLog(product_id=product.id, change_amount=item.quantity, change_type="sale_void", reference_id=label))

    # 建立時給會員的回饋點數扣回（點數不夠扣就扣到 0，差額記在原因裡）
    if so.member_id and so.earned_points:
        member = session.get(Member, so.member_id)
        if member:
            before = member.points
            deduct = min(so.earned_points, max(before, 0))
            member.points = before - deduct
            session.add(member)
            short = so.earned_points - deduct
            session.add(PointTransactionLog(
                member_id=member.id, operator_id=user.id, before_balance=before, change_amount=-deduct,
                after_balance=member.points, transaction_type="order_void",
                reason=f"出貨單報廢扣回回饋點數 ({label})" + (f"，點數不足少扣 {short}" if short else ""),
            ))

    _reverse_transactions(session, user, request, f"SO-{so.id}", label)
    _mark_voided(so, user)
    session.add(so)


def void_return_order(session: Session, ro: ReturnOrder, user: User, request: Optional[Request]):
    blocker = ro_void_blocker(session, ro, allow_pending=True)
    if blocker:
        raise HTTPException(status_code=400, detail=blocker)

    label = ro.return_number or f"RO-{ro.id}"
    # 只有已完成的退貨單動過庫存與記帳（完成時商品加回庫存、記退款支出）；待處理的單直接標記報廢
    if ro.status == "completed":
        for item in ro.items:
            product = session.get(Product, item.product_id)
            if not product or not item.quantity:
                continue
            if product.stock_quantity < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"「{product.name}」目前庫存 {product.stock_quantity}，不夠扣回這張退貨單加回的 {item.quantity} 件，"
                           "商品可能已經再賣出；請先用庫存盤點處理，不能直接報廢",
                )
            product.stock_quantity -= item.quantity
            session.add(product)
            session.add(InventoryLog(product_id=product.id, change_amount=-item.quantity, change_type="return_void", reference_id=label))
        _reverse_transactions(session, user, request, f"RO-{ro.id}", label)

    _mark_voided(ro, user)
    session.add(ro)
