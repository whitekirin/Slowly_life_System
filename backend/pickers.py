from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from backend.auth import get_current_active_user, has_any_permission
from backend.database import get_session
from backend.models import Department, Product, SalesOrder, User, UserLineBinding
from backend.notifications import is_admin_user

# 撿貨人員權限。帳號本身有這個權限，或所屬部門的預設權限含它，都算撿貨人員——
# 部門預設權限只在建立帳號時複製一次，所以要另外看部門，否則在部門管理勾選後既有成員不會生效。
PICKING_PERMISSION = "picking"

router = APIRouter(prefix="/pickers", tags=["pickers"])


class PickerRead(SQLModel):
    id: int
    username: str
    full_name: Optional[str] = None
    department: Optional[str] = None
    line_bound: bool
    line_display_name: Optional[str] = None


class PickingOrderItemRead(SQLModel):
    id: int
    product_id: int
    product_name: str
    sku: Optional[str] = None
    quantity: int
    unit_price: float
    picking_status: str


class PickingOrderRead(SQLModel):
    id: int
    order_number: Optional[str] = None
    platform: str
    customer_id: str
    status: str
    shipped_by: Optional[str] = None
    order_date: datetime
    total_quantity: int
    total_amount: float
    shopee_qrcode_image: Optional[str] = None
    items: List[PickingOrderItemRead]


def _picking_departments(session: Session) -> set[str]:
    return {d.name for d in session.exec(select(Department)).all() if PICKING_PERMISSION in (d.default_permissions or [])}


def _is_picker(user: User, picking_depts: set[str]) -> bool:
    return PICKING_PERMISSION in (user.permissions or []) or bool(user.department and user.department in picking_depts)


def is_picker(session: Session, user: User) -> bool:
    return _is_picker(user, _picking_departments(session))


def list_pickers(session: Session) -> List[User]:
    depts = _picking_departments(session)
    users = session.exec(select(User).where(User.is_active == True)).all()  # noqa: E712
    return [u for u in users if _is_picker(u, depts)]


def require_picker_or(permissions: list[str]):
    """撿貨人員（含部門繼承）或擁有任一指定權限者才可通過。
    不能直接用 require_permissions(["picking"])：它只看帳號本身的權限，會漏掉靠部門成為撿貨人員的人。"""
    def checker(session: Session = Depends(get_session), current_user: User = Depends(get_current_active_user)) -> User:
        if not (has_any_permission(current_user, permissions) or is_picker(session, current_user)):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return current_user
    return checker


def _line_user_ids(session: Session, user_ids: set[int]) -> List[str]:
    """只取有綁定 LINE 的，依 LINE userId 去重。"""
    if not user_ids:
        return []
    bindings = session.exec(select(UserLineBinding).where(UserLineBinding.user_id.in_(list(user_ids)))).all()
    return sorted({b.line_user_id for b in bindings})


def sales_order_line_recipients(session: Session) -> List[str]:
    """建立出貨單時要推 LINE 的對象：啟用中的 admin 與撿貨人員。"""
    user_ids = {u.id for u in list_pickers(session)}
    user_ids |= {u.id for u in session.exec(select(User).where(User.is_active == True)).all() if is_admin_user(u)}  # noqa: E712
    return _line_user_ids(session, user_ids)


def picker_line_recipients(session: Session, exclude_user_id: Optional[int] = None) -> List[str]:
    """出貨單更新時要推 LINE 的對象：啟用中的撿貨人員，不含做這次修改的人自己。"""
    return _line_user_ids(session, {u.id for u in list_pickers(session) if u.id != exclude_user_id})


class PickerMe(SQLModel):
    is_picker: bool


@router.get("/me", response_model=PickerMe)
def read_picker_me(session: Session = Depends(get_session), current_user: User = Depends(get_current_active_user)):
    """前端用來決定要不要顯示撿貨分頁；權限可能來自部門，前端的 hasPermission 看不到。"""
    return PickerMe(is_picker=is_picker(session, current_user))


@router.get("/orders", response_model=List[PickingOrderRead])
def read_picking_orders(session: Session = Depends(get_session), current_user: User = Depends(require_picker_or(["view_shipping"]))):
    """撿貨分頁要處理的出貨單（撿貨中／撿貨完成）。商品名稱直接帶出來，撿貨人員不需要商品管理的權限。"""
    orders = session.exec(
        select(SalesOrder)
        .where(SalesOrder.status.in_(["picking", "picked"]), SalesOrder.void_status.is_(None))  # 報廢中／已報廢的單不用撿
        .order_by(SalesOrder.order_date)
    ).all()
    result = []
    for so in orders:
        items = []
        for item in so.items:
            product = session.get(Product, item.product_id)
            items.append(PickingOrderItemRead(
                id=item.id,
                product_id=item.product_id,
                product_name=product.name if product else f"商品 #{item.product_id}",
                sku=product.sku if product else None,
                quantity=item.quantity,
                unit_price=item.unit_price,
                picking_status=item.picking_status,
            ))
        result.append(PickingOrderRead(**so.model_dump(exclude={"items"}), items=items))
    return result


@router.get("/", response_model=List[PickerRead])
def read_pickers(session: Session = Depends(get_session), current_user: User = Depends(require_picker_or(["view_shipping"]))):
    pickers = list_pickers(session)
    bindings = {b.user_id: b for b in session.exec(select(UserLineBinding).where(UserLineBinding.user_id.in_([p.id for p in pickers]))).all()} if pickers else {}
    return [
        PickerRead(
            id=p.id,
            username=p.username,
            full_name=p.full_name,
            department=p.department,
            line_bound=p.id in bindings,
            line_display_name=bindings[p.id].line_display_name if p.id in bindings else None,
        )
        for p in pickers
    ]
