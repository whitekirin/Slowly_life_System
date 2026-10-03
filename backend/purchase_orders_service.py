from typing import Iterable, Optional

from sqlmodel import Session, select

from backend.models import POItem, Product, PurchaseOrder, PurchaseOrderCreate, Supplier


def item_supplier(item, po: PurchaseOrder) -> Optional[str]:
    """採購項目實際的供應商：項目自己有填就用它，否則沿用採購單的（舊資料、LIFF 建的單）。"""
    return item.supplier_name or po.supplier_name


def summarize_suppliers(fallback: str, items: Iterable) -> str:
    """採購單層級的 supplier_name：各項目供應商去重後用「、」串起來，給列表、通知顯示用。
    項目都沒填供應商時維持原本的值。"""
    names = list(dict.fromkeys(i.supplier_name.strip() for i in items if (i.supplier_name or "").strip()))
    return "、".join(names) if names else fallback


def ensure_suppliers_for_confirmed_items(session: Session, po: PurchaseOrder) -> list[str]:
    """採購單是「已完成」時，把已勾選訂購確認的商品所屬、但供應商管理還沒有的供應商建起來。

    建採購單時可以直接打新的供應商名稱，名稱先存在採購項目上；等採購單改成已完成、
    該商品也確認訂購了，才正式建立供應商（只有名稱，細節之後到供應商管理補）。
    回傳這次新建的供應商名稱。呼叫端負責 commit。
    """
    if po.status != "completed":
        return []
    names = []
    for item in po.items:
        name = (item_supplier(item, po) or "").strip()
        product = item.product or session.get(Product, item.product_id)
        if name and product and product.is_confirmed and name not in names:
            names.append(name)
    if not names:
        return []
    existing = set(session.exec(select(Supplier.name).where(Supplier.name.in_(names))).all())
    created = [name for name in names if name not in existing]
    for name in created:
        session.add(Supplier(name=name))
    return created


def create_purchase_order(
    session: Session,
    po_in: PurchaseOrderCreate,
    purchaser_name: str,
) -> PurchaseOrder:
    """Create a purchase order and its line items.

    Equivalent to the logic previously embedded in backend/main.py's create_po route
    handler. (The LINE「填寫進貨單」LIFF endpoint that also used it was removed on
    2026-10-03; LINE users now open the staff 採購單 page instead.) Raises ValueError
    (not HTTPException) on invalid input so callers can translate it to whatever error
    shape fits their transport (HTTP 400 for REST, a LINE reply message, etc).

    Purchase orders always start as draft/completed; "received" is only reachable
    by going through the 進貨驗收作業 (Receiving) page's status transition, which
    is what actually marks products as received (see update_po in main.py). The
    guard lives here rather than in the route — enforces draft -> completed -> received.
    """
    if po_in.status == "received":
        raise ValueError("採購單不可直接以「已入庫」狀態建立，請先建立為草稿或已完成，再至驗收頁面完成入庫")

    db_po = PurchaseOrder(
        supplier_name=summarize_suppliers(po_in.supplier_name, po_in.items),
        order_date=po_in.order_date,
        status=po_in.status,
        total_amount=po_in.total_amount,
        total_weight=po_in.total_weight,
        total_shipping_fee=po_in.total_shipping_fee,
        total_cost=po_in.total_cost,
        purchaser_name=purchaser_name,
    )
    session.add(db_po)
    session.commit()
    session.refresh(db_po)

    for item in po_in.items:
        product = session.get(Product, item.product_id)
        if not product or not product.sku:
            session.delete(db_po)
            session.commit()
            raise ValueError(f"採購項目包含無效的商品 ID: {item.product_id} 或缺少 SKU")

        db_item = POItem(
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            note=item.note,
            supplier_name=(item.supplier_name or "").strip() or None,
            order_id=db_po.id,
        )
        session.add(db_item)

    session.commit()
    session.refresh(db_po)
    if ensure_suppliers_for_confirmed_items(session, db_po):
        session.commit()
        session.refresh(db_po)
    return db_po
