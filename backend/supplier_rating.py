"""供應商評分與分級。

評分 0~5 星（0.5 為單位），新供應商一律 5 星。採購單驗收入庫時若有短收，
依整張採購單的短收比例自動扣分，並寫一筆 SupplierRatingLog：

    短收比例 = 短收總數 / 採購總數
    < 10%   → -0.5 星
    10~30%  → -1   星
    >= 30%  → -1.5 星

等級由評分推導（不另存，改評分就會跟著變）：

    A 優良   >= 4.5
    B 普通   >= 3.5
    C 注意   >= 2.5
    D 高風險 <  2.5

補驗收單：同一張採購單的第 1 張補驗收單再短收不扣分（原驗收已經扣過，給一次
補寄機會）；第 2 張以後的補驗收單仍短收才扣，比例用該補驗收單的短收數／待補數。

一張採購單的商品可以來自不同供應商（POItem.supplier_name），所以短收是按供應商
分組各自計算、各自扣分：比例的分母只算該供應商在這張單（或補驗收單）的數量。
"""
from datetime import datetime
from typing import List, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from backend.purchase_orders_service import item_supplier

from backend.models import (
    POItem,
    PurchaseOrder,
    SupplementaryReceiving,
    SupplementaryReceivingItem,
    Supplier,
    SupplierRatingLog,
    SupplierRead,
)

# 同一張採購單第幾張補驗收單開始短收要扣分
SUPPLEMENTARY_PENALTY_FROM = 2

MAX_RATING = 5.0


def supplier_grade(rating: float) -> str:
    if rating >= 4.5:
        return "A"
    if rating >= 3.5:
        return "B"
    if rating >= 2.5:
        return "C"
    return "D"


def to_supplier_read(supplier: Supplier) -> SupplierRead:
    return SupplierRead.model_validate(supplier, update={"grade": supplier_grade(supplier.rating)})


def shortage_penalty(ordered: int, short: int) -> float:
    ratio = short / ordered if ordered > 0 else 0
    if ratio >= 0.3:
        return 1.5
    if ratio >= 0.1:
        return 1.0
    return 0.5


def _clamp(rating: float) -> float:
    # 保持 0.5 為單位，前端星星才畫得出來
    return max(0.0, min(MAX_RATING, round(rating * 2) / 2))


def apply_receiving_shortage(
    session: Session,
    po: PurchaseOrder,
    shortages: List[POItem],
    operator_name: Optional[str],
) -> List[SupplierRatingLog]:
    """驗收入庫有短收時呼叫：按供應商扣分、更新短收標註、寫評分紀錄。不 commit。"""
    supplier_of = {item.product_id: item_supplier(item, po) for item in po.items}
    logs = []
    for supplier_name, group in _group_by_supplier(shortages, supplier_of).items():
        ordered = sum(item.quantity for item in po.items if supplier_of[item.product_id] == supplier_name)
        log = _deduct_for_shortage(
            session, supplier_name, po.id, "receiving_shortage", f"PO-{po.id}",
            ordered, group, "採購", operator_name,
        )
        if log:
            logs.append(log)
    return logs


def apply_supplementary_shortage(
    session: Session,
    sr: SupplementaryReceiving,
    shortages: List[SupplementaryReceivingItem],
    operator_name: Optional[str],
) -> List[SupplierRatingLog]:
    """補驗收入庫仍短收時呼叫：同一張採購單第 SUPPLEMENTARY_PENALTY_FROM 張起才扣分，按供應商分開扣。不 commit。"""
    if not shortages:
        return []
    nth = session.exec(
        select(func.count(SupplementaryReceiving.id))
        .where(SupplementaryReceiving.po_id == sr.po_id, SupplementaryReceiving.id <= sr.id)
    ).one()
    if nth < SUPPLEMENTARY_PENALTY_FROM:
        return []
    po = session.get(PurchaseOrder, sr.po_id)
    po_suppliers = {item.product_id: item_supplier(item, po) for item in po.items} if po else {}
    supplier_of = {item.product_id: po_suppliers.get(item.product_id, sr.supplier_name) for item in sr.items}
    logs = []
    for supplier_name, group in _group_by_supplier(shortages, supplier_of).items():
        ordered = sum(item.quantity for item in sr.items if supplier_of[item.product_id] == supplier_name)
        log = _deduct_for_shortage(
            session, supplier_name, sr.po_id, "supplementary_shortage", f"SR-{sr.id}（PO-{sr.po_id} 第 {nth} 次補驗收）",
            ordered, group, "待補", operator_name,
        )
        if log:
            logs.append(log)
    return logs


def _group_by_supplier(items: list, supplier_of: dict) -> dict:
    groups: dict = {}
    for item in items:
        groups.setdefault(supplier_of.get(item.product_id), []).append(item)
    return groups


def _deduct_for_shortage(
    session: Session,
    supplier_name: Optional[str],
    po_id: int,
    event_type: str,
    source_label: str,
    ordered: int,
    shortages: list,
    ordered_word: str,
    operator_name: Optional[str],
) -> Optional[SupplierRatingLog]:
    # 名稱在供應商管理查不到時（手打或已刪除）直接略過
    supplier = session.exec(select(Supplier).where(Supplier.name == supplier_name)).first()
    if not supplier:
        return None

    short = sum(item.quantity - item.received_quantity for item in shortages)
    penalty = shortage_penalty(ordered, short)

    parts = []
    for item in shortages:
        name = item.product.name if item.product else f"商品 #{item.product_id}"
        reason = (item.shortage_reason or "").strip()
        parts.append(f"{name} {ordered_word} {item.quantity}／實收 {item.received_quantity}" + (f"（{reason}）" if reason else ""))
    description = f"{source_label} 短收 {short}/{ordered} 件，扣 {penalty:g} 星：" + "；".join(parts)

    before = supplier.rating
    supplier.rating = _clamp(before - penalty)
    supplier.shortage_count += 1
    supplier.last_shortage_at = datetime.now()
    supplier.last_shortage_note = description
    session.add(supplier)

    log = SupplierRatingLog(
        supplier_id=supplier.id,
        po_id=po_id,
        event_type=event_type,
        rating_before=before,
        rating_after=supplier.rating,
        description=description,
        created_by_name=operator_name,
    )
    session.add(log)
    return log


def apply_manual_rating(
    session: Session,
    supplier: Supplier,
    new_rating: float,
    reason: Optional[str],
    operator_name: Optional[str],
) -> Optional[SupplierRatingLog]:
    """手動調整評分（例如供應商改善後恢復評分）。不 commit。"""
    new_rating = _clamp(new_rating)
    if new_rating == supplier.rating:
        return None
    log = SupplierRatingLog(
        supplier_id=supplier.id,
        event_type="manual_adjust",
        rating_before=supplier.rating,
        rating_after=new_rating,
        description=(reason or "").strip() or "手動調整評分",
        created_by_name=operator_name,
    )
    supplier.rating = new_rating
    session.add(supplier)
    session.add(log)
    return log
