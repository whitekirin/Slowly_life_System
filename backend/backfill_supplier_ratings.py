"""補算供應商評分功能上線前的歷史短收（一次性，可重複執行）。

依發生時間順序，套用與線上相同的規則（backend/supplier_rating.py）：
- 已入庫採購單有短收 → 照比例扣分
- 補驗收單仍短收 → 同一張採購單第 2 張起才扣

已經有評分紀錄的事件會跳過，所以重跑不會重複扣。評分紀錄的時間用實際
驗收時間，操作人記為「歷史補算」。

    python -m backend.backfill_supplier_ratings          # 只預覽，不寫入
    python -m backend.backfill_supplier_ratings --apply  # 寫入
"""
import sys
from datetime import datetime

from sqlalchemy import func
from sqlmodel import Session, select

from backend.database import engine
from backend.models import (
    InventoryLog,
    PurchaseOrder,
    SupplementaryReceiving,
    Supplier,
    SupplierRatingLog,
)
from backend.supplier_rating import apply_receiving_shortage, apply_supplementary_shortage

OPERATOR = "歷史補算"


def _po_received_at(session: Session, po: PurchaseOrder) -> datetime:
    # PurchaseOrder 沒有入庫時間欄位，用入庫時寫的 InventoryLog 時間
    received_at = session.exec(
        select(func.min(InventoryLog.log_date)).where(
            InventoryLog.reference_id == f"PO-{po.id}", InventoryLog.change_type == "purchase"
        )
    ).one()
    return received_at or po.order_date


def _collect_events(session: Session):
    events = []
    for po in session.exec(select(PurchaseOrder).where(PurchaseOrder.status == "received")).all():
        shortages = [i for i in po.items if i.received_quantity is not None and i.received_quantity < i.quantity]
        if not shortages:
            continue
        done = session.exec(select(SupplierRatingLog).where(
            SupplierRatingLog.event_type == "receiving_shortage", SupplierRatingLog.po_id == po.id
        )).first()
        if not done:
            events.append((_po_received_at(session, po), f"PO-{po.id}", lambda s, po=po, sh=shortages: apply_receiving_shortage(s, po, sh, OPERATOR)))

    for sr in session.exec(select(SupplementaryReceiving).where(SupplementaryReceiving.status == "received")).all():
        shortages = [i for i in sr.items if i.received_quantity is not None and i.received_quantity < i.quantity]
        if not shortages:
            continue
        done = session.exec(select(SupplierRatingLog).where(
            SupplierRatingLog.event_type == "supplementary_shortage",
            SupplierRatingLog.description.startswith(f"SR-{sr.id}（"),
        )).first()
        if not done:
            events.append((sr.received_at or sr.created_at, f"SR-{sr.id}", lambda s, sr=sr, sh=shortages: apply_supplementary_shortage(s, sr, sh, OPERATOR)))

    events.sort(key=lambda e: e[0])
    return events


def main(apply: bool):
    with Session(engine) as session:
        for occurred_at, label, run in _collect_events(session):
            supplier_before = {s.id: (s.last_shortage_at, s.last_shortage_note) for s in session.exec(select(Supplier)).all()}
            logs = run(session)
            if not logs:
                print(f"{occurred_at:%Y-%m-%d %H:%M}  {label}: 不扣分（第 1 張補驗收或供應商不在供應商管理）")
                continue
            # 一張單的商品可能來自多家供應商，每家各一筆
            for log in logs:
                log.created_at = occurred_at
                supplier = session.get(Supplier, log.supplier_id)
                # 上線後已有更新的短收標註時，保留較新的那筆
                prev_at, prev_note = supplier_before[supplier.id]
                if prev_at and prev_at > occurred_at:
                    supplier.last_shortage_at, supplier.last_shortage_note = prev_at, prev_note
                else:
                    supplier.last_shortage_at = occurred_at
                session.add(log)
                session.add(supplier)
                session.flush()
                print(f"{occurred_at:%Y-%m-%d %H:%M}  {label}: {supplier.name} {log.rating_before:g} → {log.rating_after:g} 星  {log.description}")

        for s in session.exec(select(Supplier).order_by(Supplier.id)).all():
            print(f"結果：{s.name} {s.rating:g} 星，短收 {s.shortage_count} 次")

        if apply:
            session.commit()
            print("已寫入。")
        else:
            session.rollback()
            print("預覽模式，未寫入（加 --apply 才會寫入）。")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
