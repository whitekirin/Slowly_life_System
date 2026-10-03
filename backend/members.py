from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Body
from sqlmodel import Session, select, desc
from typing import Dict, List, Optional
from datetime import date, datetime, timedelta
from backend.database import get_session
from backend.models import (
    Member,
    MemberCreate,
    MemberRead,
    MemberUpdate,
    MemberAddress,
    SalesOrder,
    User,
    ProductListingBatch,
    ProductListingItem,
    Product,
    SOItem,
)
from backend.auth import get_password_hash, verify_password, create_access_token, SECRET_KEY, ALGORITHM, get_current_user, require_permissions, _token_predates_password_change
from backend.rate_limit import limiter
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel

router = APIRouter(prefix="/members", tags=["members"])
oauth2_member_scheme = OAuth2PasswordBearer(tokenUrl="/members/login")
MAX_NEW_PRODUCT_PAGE_SIZE = 50

# --- Dependencies ---

async def get_current_member(token: str = Depends(oauth2_member_scheme), session: Session = Depends(get_session)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role != "member":
            # If role is not member, it might be a system user trying to access member API?
            # Usually strict separation is better.
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    member = session.exec(select(Member).where(Member.phone == username)).first()
    if not member:
        # Try email
        member = session.exec(select(Member).where(Member.email == username)).first()

    if member is None:
        raise credentials_exception
    if _token_predates_password_change(payload, member.password_changed_at):
        raise credentials_exception
    return member


def _resolve_stock_status(stock_quantity: int) -> str:
    if stock_quantity <= 0:
        return "已售完"
    if stock_quantity <= 10:
        return "庫存緊張"
    return "現貨充足"


class AdminNewProductItem(BaseModel):
    product_id: int
    product_sku: str
    product_name: str
    category_name: str
    sales_price: float
    stock_quantity: int
    stock_status: str
    batch_id: int
    # 所有包含此商品的已發布批次（batch_id 只是最近一次）
    batch_ids: List[int] = []
    first_published_at: datetime
    last_published_at: datetime
    sales_volume: int = 0
    purchase_url: Optional[str] = None


class AdminPublishedBatchItem(BaseModel):
    product_id: int
    product_sku: str
    product_name: str
    category_name: str
    quantity: int


class AdminPublishedBatch(BaseModel):
    batch_id: int
    published_at: datetime
    created_at: datetime
    created_by_name: str
    product_count: int
    total_quantity: int
    items: List[AdminPublishedBatchItem]


class AdminNewProductCategoryBreakdown(BaseModel):
    category_name: str
    product_count: int


class AdminNewProductMonthlyTrend(BaseModel):
    month: str
    product_count: int
    sales_volume: int


class AdminNewProductSalesRanking(BaseModel):
    product_name: str
    sales_volume: int


class AdminNewProductOverviewResponse(BaseModel):
    current_month_label: str
    total_online_products: int
    current_month_total: int
    total_sales_volume: int
    total_in_stock_products: int
    average_sales_volume: float
    category_options: List[str]
    category_breakdown: List[AdminNewProductCategoryBreakdown]
    monthly_launch_trend: List[AdminNewProductMonthlyTrend]
    top_selling_products: List[AdminNewProductSalesRanking]


class AdminNewProductListResponse(BaseModel):
    scope: str
    current_month_label: str
    total: int
    page: int
    page_size: int
    total_pages: int
    items: List[AdminNewProductItem]


class AdminNewProductExportResponse(BaseModel):
    scope: str
    current_month_label: str
    total: int
    items: List[AdminNewProductItem]


def _build_published_product_catalog(session: Session) -> List[AdminNewProductItem]:
    published_batches = session.exec(
        select(ProductListingBatch)
        .where(ProductListingBatch.status == "published")
        .order_by(desc(ProductListingBatch.published_at), desc(ProductListingBatch.created_at))
    ).all()

    if not published_batches:
        return []

    product_publish_map: Dict[int, Dict[str, datetime | int]] = {}
    for batch in published_batches:
        published_at = batch.published_at or batch.created_at
        items = session.exec(
            select(ProductListingItem).where(ProductListingItem.batch_id == batch.id)
        ).all()
        for item in items:
            current = product_publish_map.get(item.product_id)
            if current is None:
                product_publish_map[item.product_id] = {
                    "first_published_at": published_at,
                    "last_published_at": published_at,
                    "batch_id": batch.id,
                    "batch_ids": [batch.id],
                }
                continue

            if batch.id not in current["batch_ids"]:
                current["batch_ids"].append(batch.id)
            if published_at < current["first_published_at"]:
                current["first_published_at"] = published_at
            if published_at >= current["last_published_at"]:
                current["last_published_at"] = published_at
                current["batch_id"] = batch.id

    sales_volume_map: Dict[int, int] = {}
    for item in session.exec(select(SOItem)).all():
        sales_volume_map[item.product_id] = sales_volume_map.get(item.product_id, 0) + item.quantity

    catalog_items: List[AdminNewProductItem] = []
    for product_id, publish_info in product_publish_map.items():
        product = session.get(Product, product_id)
        if not product:
            continue
        if not product.name or product.sales_price is None:
            continue

        catalog_items.append(
            AdminNewProductItem(
                product_id=product.id,
                product_sku=product.sku,
                product_name=product.name,
                category_name=(product.category_name or "").strip() or "未分類",
                sales_price=product.sales_price or 0.0,
                stock_quantity=product.stock_quantity or 0,
                stock_status=_resolve_stock_status(product.stock_quantity or 0),
                batch_id=int(publish_info["batch_id"]),
                batch_ids=sorted(publish_info["batch_ids"], reverse=True),
                first_published_at=publish_info["first_published_at"],
                last_published_at=publish_info["last_published_at"],
                sales_volume=sales_volume_map.get(product.id, 0),
                purchase_url=product.purchase_url or product.source_url,
            )
        )

    catalog_items.sort(
        key=lambda item: (
            item.last_published_at,
            item.first_published_at,
            item.product_name.lower(),
        ),
        reverse=True,
    )
    return catalog_items


def _build_published_batches(session: Session) -> List[AdminPublishedBatch]:
    published_batches = session.exec(
        select(ProductListingBatch)
        .where(ProductListingBatch.status == "published")
        .order_by(desc(ProductListingBatch.published_at), desc(ProductListingBatch.created_at))
    ).all()

    result: List[AdminPublishedBatch] = []
    for batch in published_batches:
        creator = session.get(User, batch.created_by_id)
        creator_name = (creator.full_name or creator.username) if creator else "System"
        batch_items: List[AdminPublishedBatchItem] = []
        for item in session.exec(
            select(ProductListingItem).where(ProductListingItem.batch_id == batch.id)
        ).all():
            product = session.get(Product, item.product_id)
            if not product:
                continue
            batch_items.append(
                AdminPublishedBatchItem(
                    product_id=product.id,
                    product_sku=product.sku or "",
                    product_name=product.name or "",
                    category_name=(product.category_name or "").strip() or "未分類",
                    quantity=item.quantity,
                )
            )
        result.append(
            AdminPublishedBatch(
                batch_id=batch.id,
                published_at=batch.published_at or batch.created_at,
                created_at=batch.created_at,
                created_by_name=creator_name,
                product_count=len(batch_items),
                total_quantity=sum(item.quantity for item in batch_items),
                items=batch_items,
            )
        )
    return result


def _is_current_month(dt: datetime, now: datetime) -> bool:
    return dt.year == now.year and dt.month == now.month


def _apply_new_product_filters(
    items: List[AdminNewProductItem],
    *,
    scope: str,
    start_date: Optional[date],
    end_date: Optional[date],
    category: Optional[str],
    min_sales: Optional[int],
    max_sales: Optional[int],
    sort_by: str,
    sort_order: str,
    batch_id: Optional[int] = None,
) -> List[AdminNewProductItem]:
    now = datetime.now()
    filtered: List[AdminNewProductItem] = []

    for item in items:
        published_date = item.first_published_at.date()
        if scope == "current_month" and not _is_current_month(item.first_published_at, now):
            continue
        if start_date and published_date < start_date:
            continue
        if end_date and published_date > end_date:
            continue
        if category and item.category_name != category:
            continue
        if min_sales is not None and item.sales_volume < min_sales:
            continue
        if max_sales is not None and item.sales_volume > max_sales:
            continue
        if batch_id is not None and batch_id not in item.batch_ids:
            continue
        filtered.append(item)

    reverse = sort_order != "asc"

    if sort_by == "sales_volume":
        filtered.sort(
            key=lambda item: (item.sales_volume, item.last_published_at, item.product_name.lower()),
            reverse=reverse,
        )
    elif sort_by == "category_name":
        filtered.sort(
            key=lambda item: (item.category_name, item.last_published_at, item.product_name.lower()),
            reverse=reverse,
        )
    else:
        filtered.sort(
            key=lambda item: (item.first_published_at, item.last_published_at, item.product_name.lower()),
            reverse=reverse,
        )

    return filtered


def _current_month_label() -> str:
    now = datetime.now()
    return f"{now.year}年{now.month:02d}月"


def _validate_new_product_scope(scope: str) -> str:
    if scope not in {"all", "current_month"}:
        raise HTTPException(status_code=400, detail="Invalid scope")
    return scope


def _validate_sort_by(sort_by: str) -> str:
    if sort_by not in {"first_published_at", "sales_volume", "category_name"}:
        raise HTTPException(status_code=400, detail="Invalid sort_by")
    return sort_by


def _validate_sort_order(sort_order: str) -> str:
    if sort_order not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="Invalid sort_order")
    return sort_order


def _clamp_page_size(page_size: int) -> int:
    return max(1, min(page_size, MAX_NEW_PRODUCT_PAGE_SIZE))

# --- Auth Routes ---

@router.post("/register", response_model=MemberRead)
async def register_member(member_in: MemberCreate, session: Session = Depends(get_session)):
    # Check if phone or email exists
    existing_phone = session.exec(select(Member).where(Member.phone == member_in.phone)).first()
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone number already registered")
    
    if member_in.email:
        existing_email = session.exec(select(Member).where(Member.email == member_in.email)).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="Email already registered")
            
    # Hash password
    if not member_in.password:
        raise HTTPException(status_code=400, detail="Password is required")
        
    hashed_password = get_password_hash(member_in.password)
    
    member_data = member_in.dict(exclude={"password"})
    member = Member(**member_data)
    member.password_hash = hashed_password
    member.created_at = datetime.now()
    member.updated_at = datetime.now()
    
    session.add(member)
    session.commit()
    session.refresh(member)
    
    # "Sync" logic - mock or log
    # In a real scenario with external system, we would trigger a background task here
    print(f"Syncing member {member.id} to Inventory System...")
    
    return member

@router.post("/login")
@limiter.limit("10/minute")
async def login_member(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    # Username can be phone or email
    member = session.exec(select(Member).where(Member.phone == form_data.username)).first()
    if not member:
        member = session.exec(select(Member).where(Member.email == form_data.username)).first()

    if not member or not member.password_hash or not verify_password(form_data.password, member.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect phone/email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not member.is_active:
        raise HTTPException(status_code=400, detail="Member account is inactive")

    access_token_expires = timedelta(minutes=60 * 24 * 7) # 7 days
    access_token = create_access_token(
        data={"sub": member.phone, "role": "member", "id": member.id}, # Use phone as sub
        expires_delta=access_token_expires
    )
    # See the equivalent fix on the employee /token endpoint in main.py: without
    # this, the raw ORM `member` object serializes to {} once the request-scoped
    # session closes.
    return {"access_token": access_token, "token_type": "bearer", "member": MemberRead.model_validate(member)}

# --- Member Profile Routes ---

@router.get("/me", response_model=MemberRead)
async def read_users_me(current_member: Member = Depends(get_current_member)):
    return current_member

@router.patch("/me", response_model=MemberRead)
async def update_member_me(member_in: MemberUpdate, current_member: Member = Depends(get_current_member), session: Session = Depends(get_session)):
    member_data = member_in.dict(exclude_unset=True)
    for key, value in member_data.items():
        setattr(current_member, key, value)
    
    current_member.updated_at = datetime.now()
    session.add(current_member)
    session.commit()
    session.refresh(current_member)
    return current_member

@router.get("/me/orders")
async def read_member_orders(current_member: Member = Depends(get_current_member), session: Session = Depends(get_session)):
    # Assuming SalesOrder has member_id
    orders = session.exec(select(SalesOrder).where(SalesOrder.member_id == current_member.id).order_by(desc(SalesOrder.order_date))).all()
    return orders


@router.post("/me/addresses", response_model=MemberAddress)
async def create_address(address: MemberAddress, current_member: Member = Depends(get_current_member), session: Session = Depends(get_session)):
    address.member_id = current_member.id
    
    # If default, unset other defaults
    if address.is_default:
        existing = session.exec(select(MemberAddress).where(MemberAddress.member_id == current_member.id)).all()
        for addr in existing:
            addr.is_default = False
            session.add(addr)
            
    session.add(address)
    session.commit()
    session.refresh(address)
    return address

@router.get("/me/addresses", response_model=List[MemberAddress])
async def read_addresses(current_member: Member = Depends(get_current_member), session: Session = Depends(get_session)):
    return current_member.addresses

# --- Admin Routes ---

@router.get("/admin/new-products/overview", response_model=AdminNewProductOverviewResponse)
async def read_admin_new_products_overview(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    category: Optional[str] = Query(default=None),
    min_sales: Optional[int] = Query(default=None, ge=0),
    max_sales: Optional[int] = Query(default=None, ge=0),
    sort_by: str = Query(default="first_published_at"),
    sort_order: str = Query(default="desc"),
    batch_id: Optional[int] = Query(default=None),
    current_user: User = Depends(require_permissions(["view_new_products"])),
    session: Session = Depends(get_session),
):
    _ = current_user
    normalized_sort_by = _validate_sort_by(sort_by)
    normalized_sort_order = _validate_sort_order(sort_order)
    all_items = _build_published_product_catalog(session)
    filtered_all_items = _apply_new_product_filters(
        all_items,
        scope="all",
        start_date=start_date,
        end_date=end_date,
        category=category,
        min_sales=min_sales,
        max_sales=max_sales,
        sort_by=normalized_sort_by,
        sort_order=normalized_sort_order,
        batch_id=batch_id,
    )
    filtered_current_month_items = _apply_new_product_filters(
        all_items,
        scope="current_month",
        start_date=start_date,
        end_date=end_date,
        category=category,
        min_sales=min_sales,
        max_sales=max_sales,
        sort_by=normalized_sort_by,
        sort_order=normalized_sort_order,
        batch_id=batch_id,
    )

    category_counts: Dict[str, int] = {}
    monthly_summary: Dict[str, Dict[str, int]] = {}
    for item in filtered_all_items:
        category_counts[item.category_name] = category_counts.get(item.category_name, 0) + 1
        month_key = item.first_published_at.strftime("%Y-%m")
        if month_key not in monthly_summary:
            monthly_summary[month_key] = {"product_count": 0, "sales_volume": 0}
        monthly_summary[month_key]["product_count"] += 1
        monthly_summary[month_key]["sales_volume"] += item.sales_volume

    total_sales_volume = sum(item.sales_volume for item in filtered_all_items)
    total_in_stock_products = sum(1 for item in filtered_all_items if item.stock_quantity > 0)
    total_products = len(filtered_all_items)
    average_sales_volume = round(total_sales_volume / total_products, 2) if total_products else 0.0

    category_breakdown = [
        AdminNewProductCategoryBreakdown(category_name=name, product_count=count)
        for name, count in sorted(category_counts.items(), key=lambda entry: (-entry[1], entry[0]))
    ]
    monthly_launch_trend = [
        AdminNewProductMonthlyTrend(
            month=month_key,
            product_count=summary["product_count"],
            sales_volume=summary["sales_volume"],
        )
        for month_key, summary in sorted(monthly_summary.items())
    ]
    top_selling_products = [
        AdminNewProductSalesRanking(product_name=item.product_name, sales_volume=item.sales_volume)
        for item in sorted(
            filtered_all_items,
            key=lambda entry: (entry.sales_volume, entry.last_published_at, entry.product_name.lower()),
            reverse=True,
        )[:10]
    ]
    category_options = sorted({item.category_name for item in all_items})

    return AdminNewProductOverviewResponse(
        current_month_label=_current_month_label(),
        total_online_products=total_products,
        current_month_total=len(filtered_current_month_items),
        total_sales_volume=total_sales_volume,
        total_in_stock_products=total_in_stock_products,
        average_sales_volume=average_sales_volume,
        category_options=category_options,
        category_breakdown=category_breakdown,
        monthly_launch_trend=monthly_launch_trend,
        top_selling_products=top_selling_products,
    )


@router.get("/admin/new-products/list", response_model=AdminNewProductListResponse)
async def read_admin_new_products_list(
    scope: str = Query(default="all"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=MAX_NEW_PRODUCT_PAGE_SIZE),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    category: Optional[str] = Query(default=None),
    min_sales: Optional[int] = Query(default=None, ge=0),
    max_sales: Optional[int] = Query(default=None, ge=0),
    sort_by: str = Query(default="first_published_at"),
    sort_order: str = Query(default="desc"),
    batch_id: Optional[int] = Query(default=None),
    current_user: User = Depends(require_permissions(["view_new_products"])),
    session: Session = Depends(get_session),
):
    _ = current_user
    normalized_scope = _validate_new_product_scope(scope)
    normalized_sort_by = _validate_sort_by(sort_by)
    normalized_sort_order = _validate_sort_order(sort_order)
    normalized_page_size = _clamp_page_size(page_size)
    filtered_items = _apply_new_product_filters(
        _build_published_product_catalog(session),
        scope=normalized_scope,
        start_date=start_date,
        end_date=end_date,
        category=category,
        min_sales=min_sales,
        max_sales=max_sales,
        sort_by=normalized_sort_by,
        sort_order=normalized_sort_order,
        batch_id=batch_id,
    )

    total = len(filtered_items)
    start_index = (page - 1) * normalized_page_size
    end_index = start_index + normalized_page_size
    page_items = filtered_items[start_index:end_index]
    total_pages = (total + normalized_page_size - 1) // normalized_page_size if total else 0

    return AdminNewProductListResponse(
        scope=normalized_scope,
        current_month_label=_current_month_label(),
        total=total,
        page=page,
        page_size=normalized_page_size,
        total_pages=total_pages,
        items=page_items,
    )


@router.get("/admin/new-products/export", response_model=AdminNewProductExportResponse)
async def export_admin_new_products(
    scope: str = Query(default="all"),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    category: Optional[str] = Query(default=None),
    min_sales: Optional[int] = Query(default=None, ge=0),
    max_sales: Optional[int] = Query(default=None, ge=0),
    sort_by: str = Query(default="first_published_at"),
    sort_order: str = Query(default="desc"),
    batch_id: Optional[int] = Query(default=None),
    current_user: User = Depends(require_permissions(["view_new_products"])),
    session: Session = Depends(get_session),
):
    _ = current_user
    normalized_scope = _validate_new_product_scope(scope)
    normalized_sort_by = _validate_sort_by(sort_by)
    normalized_sort_order = _validate_sort_order(sort_order)
    filtered_items = _apply_new_product_filters(
        _build_published_product_catalog(session),
        scope=normalized_scope,
        start_date=start_date,
        end_date=end_date,
        category=category,
        min_sales=min_sales,
        max_sales=max_sales,
        sort_by=normalized_sort_by,
        sort_order=normalized_sort_order,
        batch_id=batch_id,
    )

    return AdminNewProductExportResponse(
        scope=normalized_scope,
        current_month_label=_current_month_label(),
        total=len(filtered_items),
        items=filtered_items,
    )

@router.get("/admin/new-products/batches", response_model=List[AdminPublishedBatch])
async def read_admin_new_product_batches(
    current_user: User = Depends(require_permissions(["view_new_products"])),
    session: Session = Depends(get_session),
):
    """已發布（上線到會員系統）的上架批次與各批次內容。"""
    _ = current_user
    return _build_published_batches(session)


@router.get("/", response_model=List[MemberRead])
async def read_members(
    skip: int = 0, 
    limit: int = 100, 
    level: Optional[str] = None,
    month: Optional[int] = None,
    active: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: User = Depends(require_permissions(["view_members"])), # Admin/Staff only
    session: Session = Depends(get_session)
):
    query = select(Member)
    
    if level:
        query = query.where(Member.level == level)
    if active is not None:
        query = query.where(Member.is_active == active)
    if month:
        # Filter by birthday month - simplified, might need SQL function
        # SQLModel doesn't support extract directly easily without sqlalchemy
        from sqlalchemy import extract
        query = query.where(extract('month', Member.birthday) == month)
    if search:
        query = query.where(
            (Member.name.contains(search)) | 
            (Member.phone.contains(search)) | 
            (Member.email.contains(search))
        )
        
    query = query.offset(skip).limit(limit).order_by(desc(Member.created_at))
    members = session.exec(query).all()
    return members

# member_id 只接受數字：否則 /members/new-products（員工後台「新品總覽」頁）重新整理時會被這裡接走、回 401
@router.get("/{member_id:int}", response_model=MemberRead)
async def read_member(member_id: int, current_user: User = Depends(require_permissions(["view_members"])), session: Session = Depends(get_session)):
    member = session.get(Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return member

@router.patch("/{member_id:int}", response_model=MemberRead)
async def update_member_admin(member_id: int, member_in: MemberUpdate, current_user: User = Depends(require_permissions(["edit_members"])), session: Session = Depends(get_session)):
    member = session.get(Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    # Audit log
    old_data = member.model_dump()
        
    member_data = member_in.dict(exclude_unset=True)
    # Check if points are manually adjusted
    if "points" in member_data and member_data["points"] != old_data.get("points"):
        from backend.models import PointTransactionLog
        change_amount = member_data["points"] - old_data.get("points", 0)
        tx = PointTransactionLog(
            member_id=member.id,
            operator_id=current_user.id,
            before_balance=old_data.get("points", 0),
            change_amount=change_amount,
            after_balance=member_data["points"],
            reason="管理員手動調整",
            transaction_type="system_adjustment"
        )
        session.add(tx)

    for key, value in member_data.items():
        setattr(member, key, value)
        
    member.updated_at = datetime.now()
    session.add(member)
    session.commit()
    session.refresh(member)
    
    # 系統日誌由 system_log_middleware 自動記錄（含每個欄位的修改前後值），這裡不另外寫
    return member

@router.post("/{member_id:int}/sync")
async def sync_member_manual(member_id: int, current_user: User = Depends(require_permissions(["edit_members"])), session: Session = Depends(get_session)):
    member = session.get(Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # Mock sync
    return {"status": "synced", "timestamp": datetime.now()}
