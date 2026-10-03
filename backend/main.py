import sys
import os

# Add parent directory to sys.path to allow running from backend/ directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, status, Request, WebSocket, WebSocketDisconnect, Body, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from sqlalchemy import update as sa_update, func as sa_func
from backend.database import create_db_and_tables, get_session, engine
from backend.models import *
from backend.auth import (
    verify_password, create_access_token, get_password_hash,
    ACCESS_TOKEN_EXPIRE_MINUTES, get_current_user,
    create_password_reset_token, verify_reset_token,
    SECRET_KEY, ALGORITHM, require_permissions, has_any_permission
)
from backend.config import settings
from backend.email_utils import send_reset_password_email
from backend.system_log import router as system_log_router, create_log
from backend import audit
from backend.members import router as members_router
from backend.dms import router as dms_router
from backend.mail_symbols import router as mail_symbols_router
from backend.points_store import router as points_store_router
from backend.marketing import router as marketing_router
from backend.line_router import router as line_router
from backend.line_webhook_router import router as line_webhook_router
from backend.liff_router import router as liff_router
from backend.notifications import router as notifications_router, notify_admins
from backend.pickers import router as pickers_router, sales_order_line_recipients, picker_line_recipients, require_picker_or
from backend.supplementary_receivings import router as supplementary_receivings_router, create_supplementary, ensure_can_create_supplementary
from backend.change_requests import router as change_requests_router, authorize_locked_change, add_log
from backend.voiding import ensure_not_voided, void_purchase_order, void_return_order, void_sales_order
from backend.line_utils import push_line_message_sync, build_purchase_received_message, build_sale_shipped_message, build_sales_order_created_message, build_sales_order_updated_message
from backend.purchase_orders_service import create_purchase_order, ensure_suppliers_for_confirmed_items, summarize_suppliers
from backend.supplier_rating import apply_receiving_shortage, apply_manual_rating, to_supplier_read
from backend.line_richmenu import sync_users_in_background, unlink_rich_menu
from backend.user_permissions import normalize_permissions, apply_user_permissions, extras_from_legacy_permissions
from backend.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from datetime import timedelta
from sqlalchemy.exc import IntegrityError
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Optional
from pydantic import BaseModel, EmailStr
from jose import JWTError, jwt
import random
from collections import Counter
import string
import shutil
import secrets

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

import asyncio
from backend.marketing import execute_campaign

async def marketing_scheduler():
    """Background task to process scheduled campaigns and automated triggers"""
    while True:
        try:
            with Session(engine) as session:
                # 1. Check Scheduled Campaigns
                now = datetime.now()
                scheduled_campaigns = session.exec(
                    select(Campaign).where(
                        Campaign.status == "scheduled",
                        Campaign.scheduled_at <= now
                    )
                ).all()
                for campaign in scheduled_campaigns:
                    await execute_campaign(campaign.id, session)
                
                # 2. Check Automated Triggers (e.g. Birthday)
                # We can implement birthday checking here, for MVP just leaving a placeholder
                # to run once a day
        except Exception as e:
            print(f"Marketing scheduler error: {e}")
            
        await asyncio.sleep(60) # Check every minute

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    
    # Start the marketing scheduler background task
    scheduler_task = asyncio.create_task(marketing_scheduler())
    
    # Create default admin user on first boot only. The password is randomly
    # generated per-deployment and never hardcoded (a fixed default like
    # admin/password, or a fixed password committed to source, is a standing
    # "skip the front door" credential for every install that shares it) —
    # printed once to the server log, and force_password_change makes sure
    # whoever reads that log can't just keep using it indefinitely.
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == "admin")).first()
        if not user:
            bootstrap_password = secrets.token_urlsafe(18)
            user = User(
                username="admin",
                hashed_password=get_password_hash(bootstrap_password),
                full_name="Admin User",
                is_superuser=True,
                permissions=["all"],
                extra_permissions=["all"],
                settings={},
                force_password_change=True,
            )
            session.add(user)
            session.commit()
            print(
                "="*72 + "\n"
                "第一次啟動：已建立 admin 帳號，初始密碼僅顯示這一次，請立即登入並更改：\n"
                f"  username: admin\n  password: {bootstrap_password}\n" +
                "="*72,
                flush=True,
            )
        # Fix for legacy rows where hashed_password literally stored the plaintext "password".
        elif user.hashed_password == "password":
            user.hashed_password = get_password_hash(secrets.token_urlsafe(18))
            user.force_password_change = True
            user.password_changed_at = datetime.utcnow()
            session.add(user)
            session.commit()
    yield

app = FastAPI(lifespan=lifespan, title="Smart Inventory ERP")
app.state.log_engine = engine
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

_cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system_log_router)
app.include_router(members_router)
app.include_router(dms_router)
app.include_router(mail_symbols_router)
app.include_router(points_store_router)
app.include_router(marketing_router)
app.include_router(line_router)
app.include_router(line_webhook_router)
app.include_router(liff_router)
app.include_router(notifications_router)
app.include_router(pickers_router)
app.include_router(supplementary_receivings_router)
app.include_router(change_requests_router)



def _extract_username_from_request(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.query_params.get("token")
    if not token:
        return "anonymous"
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return "anonymous"
        if payload.get("role") == "member":
            return f"會員 {username}"  # 會員 token 的 sub 是手機號碼，和員工帳號區分開
        return username
    except JWTError:
        return "anonymous"

def _resolve_resource_from_path(path: str) -> str:
    segments = [segment for segment in path.strip("/").split("/") if segment]
    if not segments:
        return "root"
    return segments[0]

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

@app.middleware("http")
async def system_log_middleware(request: Request, call_next):
    """系統日誌：記錄誰做了什麼操作、改了哪些資料（明細由 backend/audit.py 從資料庫異動自動產生）。
    只記寫入類的請求；單純查看頁面（GET）不是操作，不記。"""
    path = request.url.path
    method = request.method.upper()
    if (
        method not in _MUTATING_METHODS
        or path.startswith("/static")
        or path.startswith("/system-logs")
        or path == "/token"  # 員工登入由 login_for_access_token 自己記
    ):
        return await call_next(request)

    username = _extract_username_from_request(request)
    resource = _resolve_resource_from_path(path)
    ctx = audit.begin_request()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        audit.end_request(ctx)
        route = request.scope.get("route")
        endpoint_name = getattr(route, "name", None)
        if endpoint_name not in audit.SKIPPED_ENDPOINTS:
            try:
                action, operation = audit.resolve_operation(endpoint_name, method, ctx)
                failed = status_code >= 400
                # 成功但沒有改到任何資料、業務程式也沒自己寫日誌的請求（例如只是驗證資料）不記
                should_log = (
                    failed
                    or ctx.committed
                    or endpoint_name in audit.ALWAYS_LOG_ENDPOINTS
                )
                # 未登入者的失敗請求（掃描、過期 token）不是系統內的操作，不記
                if failed and username == "anonymous" and status_code in (401, 403, 404, 405):
                    should_log = False
                if should_log:
                    details = audit.build_details(
                        operation, ctx, failure=audit.failure_label(status_code) if failed else None,
                    )
                    with Session(ctx.bind or app.state.log_engine) as log_session:
                        create_log(
                            session=log_session,
                            username=username,
                            action=action,
                            resource=resource,
                            details=details,
                            status="failure" if failed else "success",
                        )
            except Exception as exc:
                print(f"Failed to write system log: {exc}")

@app.post("/token")
@limiter.limit("10/minute")
async def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        create_log(session, form_data.username, "login", "auth", "登入失敗\n原因：帳號或密碼錯誤", "failure")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    create_log(session, user.username, "login", "auth", "登入系統", "success")
    # Without an explicit response_model, returning the raw ORM `user` object
    # here serializes to an empty {} — by the time FastAPI encodes the response
    # body, `session` (a yield-based dependency) has already closed and every
    # lazily-evaluated attribute on the SQLAlchemy instance comes back empty.
    # UserRead.model_validate() reads the values while the session is still
    # open and returns a plain pydantic object that serializes correctly.
    return {"access_token": access_token, "token_type": "bearer", "user": UserRead.model_validate(user)}

@app.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == request.email)).first()
    if not user:
        # Return success even if user not found to prevent enumeration
        # But for development/UX we might want to be explicit? 
        # Best practice is generic message, but user asked for "Invalid email prompt" (error handling mechanism including invalid email prompt).
        # So I will return 404 or specific error as requested.
        raise HTTPException(status_code=404, detail="此電子郵件未註冊 (Email not found)")
    
    token = create_password_reset_token(user.email)
    # Background task or direct? Direct for simplicity now.
    # In production use BackgroundTasks
    try:
        await send_reset_password_email(request.email, token, base_url=settings.FRONTEND_BASE_URL)
    except Exception as e:
        print(f"Failed to send email: {e}")
        raise HTTPException(status_code=500, detail="無法發送郵件，請稍後再試 (Failed to send email)")
        
    return {"message": "重設密碼郵件已發送 (Password reset email sent)"}

@app.post("/auth/reset-password")
async def reset_password(request: ResetPasswordRequest, session: Session = Depends(get_session)):
    email = verify_reset_token(request.token, session)
    if not email:
        raise HTTPException(status_code=400, detail="無效或過期的連結 (Invalid or expired token)")

    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在 (User not found)")

    user.hashed_password = get_password_hash(request.new_password)
    user.force_password_change = False # Reset this flag if set
    # Bumping this both invalidates every JWT issued before this reset (see
    # get_current_user) and makes the reset token itself single-use: a second
    # attempt to reuse request.token will now fail verify_reset_token's
    # password_changed_at comparison.
    user.password_changed_at = datetime.utcnow()
    session.add(user)
    session.commit()

    return {"message": "密碼重設成功 (Password reset successful)"}

@app.get("/users/me/", response_model=UserRead)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


# Mount static files (absolute path so it doesn't depend on uvicorn's launch cwd)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    try:
        # Create a safe filename
        file_extension = os.path.splitext(file.filename)[1]
        random_name = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
        filename = f"{random_name}{file_extension}"

        # Ensure directory exists
        upload_dir = os.path.join(BASE_DIR, "static", "uploads")
        os.makedirs(upload_dir, exist_ok=True)

        file_path = os.path.join(upload_dir, filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Absolute URL built from PUBLIC_BASE_URL so it resolves correctly regardless
        # of where it's displayed (dev: localhost:8000 default, matching old hardcoded
        # value; prod: the deployed domain, set via .env).
        return {"url": f"{settings.PUBLIC_BASE_URL}/static/uploads/{filename}"}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

# Attribute API
@app.post("/attributes/", response_model=AttributeRead)
def create_attribute(attribute: AttributeCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_products"]))):
    try:
        db_attr = Attribute.model_validate(attribute)
        session.add(db_attr)
        session.commit()
        session.refresh(db_attr)
        return db_attr
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Attribute name already exists")

@app.get("/attributes/", response_model=List[AttributeRead])
def read_attributes(session: Session = Depends(get_session)):
    return session.exec(select(Attribute)).all()

@app.delete("/attributes/{attr_id}")
def delete_attribute(attr_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_products"]))):
    db_attr = session.get(Attribute, attr_id)
    if not db_attr:
        raise HTTPException(status_code=404, detail="Attribute not found")
    session.delete(db_attr)
    session.commit()
    return {"ok": True}

@app.post("/attributes/{attr_id}/options/", response_model=AttributeOptionRead)
def create_attribute_option(attr_id: int, option: AttributeOptionCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_products"]))):
    if option.attribute_id != attr_id:
        raise HTTPException(status_code=400, detail="Attribute ID mismatch")
    db_attr = session.get(Attribute, attr_id)
    if not db_attr:
        raise HTTPException(status_code=404, detail="Attribute not found")
    
    db_opt = AttributeOption.model_validate(option)
    session.add(db_opt)
    session.commit()
    session.refresh(db_opt)
    return db_opt

@app.delete("/attribute_options/{opt_id}")
def delete_attribute_option(opt_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_products"]))):
    db_opt = session.get(AttributeOption, opt_id)
    if not db_opt:
        raise HTTPException(status_code=404, detail="Option not found")
    session.delete(db_opt)
    session.commit()
    return {"ok": True}

@app.post("/attributes/ensure", response_model=AttributeOptionRead)
def ensure_attribute_option(name: str = Body(...), value: str = Body(...), session: Session = Depends(get_session)):
    """
    Finds or creates an Attribute by name, then finds or creates an AttributeOption by value under that Attribute.
    Returns the AttributeOption.
    """
    # 1. Ensure Attribute
    attr = session.exec(select(Attribute).where(Attribute.name == name)).first()
    if not attr:
        attr = Attribute(name=name)
        session.add(attr)
        session.commit()
        session.refresh(attr)
        
    # 2. Ensure Option
    opt = session.exec(select(AttributeOption).where(AttributeOption.attribute_id == attr.id).where(AttributeOption.value == value)).first()
    if not opt:
        opt = AttributeOption(attribute_id=attr.id, value=value)
        session.add(opt)
        session.commit()
        session.refresh(opt)
        
    return opt

# Products API
@app.post("/products/", response_model=ProductRead)
def create_product(product: ProductCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_products"]))):
    db_product = Product.model_validate(product)
    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    
    if product.attribute_option_ids:
        for opt_id in product.attribute_option_ids:
            link = ProductAttributeLink(product_id=db_product.id, option_id=opt_id)
            session.add(link)
        session.commit()
        session.refresh(db_product)
        
    # Manually populate attribute_options for response
    options = [link.option for link in db_product.attribute_links]
    return ProductRead(**db_product.model_dump(), attribute_options=options)

@app.get("/products/", response_model=List[ProductRead])
def read_products(offset: int = 0, limit: int = 1000, session: Session = Depends(get_session)):
    products = session.exec(select(Product).offset(offset).limit(limit)).all()
    results = []
    for p in products:
        opts = [link.option for link in p.attribute_links]
        results.append(ProductRead(**p.model_dump(), attribute_options=opts))
    return results

@app.get("/products/receiving_notes")
def read_product_receiving_notes(
    product_ids: List[int] = Query(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_products"])),
):
    """商品詳情用：這些商品在已入庫採購單與補驗收單上填過的驗收備註，新的在前。報廢的單不列。"""
    notes = []
    po_items = session.exec(
        select(POItem, PurchaseOrder)
        .join(PurchaseOrder, POItem.order_id == PurchaseOrder.id)
        .where(POItem.product_id.in_(product_ids), PurchaseOrder.status == "received",
               PurchaseOrder.void_status.is_(None))
    ).all()
    for item, po in po_items:
        if (item.note or "").strip():
            notes.append({
                "product_id": item.product_id, "source": f"PO-{po.id}", "po_id": po.id,
                "supplier_name": item.supplier_name or po.supplier_name,
                "date": po.order_date, "note": item.note.strip(),
            })
    sr_items = session.exec(
        select(SupplementaryReceivingItem, SupplementaryReceiving)
        .join(SupplementaryReceiving, SupplementaryReceivingItem.supplementary_receiving_id == SupplementaryReceiving.id)
        .where(SupplementaryReceivingItem.product_id.in_(product_ids), SupplementaryReceiving.status == "received")
    ).all()
    for item, sr in sr_items:
        if (item.note or "").strip():
            notes.append({
                "product_id": item.product_id, "source": f"SR-{sr.id}", "po_id": sr.po_id,
                "supplier_name": sr.supplier_name,
                "date": sr.received_at or sr.created_at, "note": item.note.strip(),
            })
    notes.sort(key=lambda n: n["date"] or datetime.min, reverse=True)
    return notes

@app.get("/products/{product_id}", response_model=ProductRead)
def read_product(product_id: int, session: Session = Depends(get_session)):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    opts = [link.option for link in product.attribute_links]
    return ProductRead(**product.model_dump(), attribute_options=opts)

@app.patch("/products/{product_id}", response_model=ProductRead)
def update_product(product_id: int, product_update: ProductUpdate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_products"]))):
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    product_data = product_update.model_dump(exclude_unset=True)
    
    # Security: Prevent SKU modification
    if "sku" in product_data and product_data["sku"] != db_product.sku:
        raise HTTPException(status_code=400, detail="SKU cannot be modified (Read-Only)")
        
    # Handle attribute_option_ids
    if "attribute_option_ids" in product_data:
        opt_ids = product_data.pop("attribute_option_ids")
        # Clear existing
        for link in list(db_product.attribute_links):
            session.delete(link)
        # Add new
        if opt_ids:
            for opt_id in opt_ids:
                session.add(ProductAttributeLink(product_id=db_product.id, option_id=opt_id))
    
    db_product.sqlmodel_update(product_data)
    session.add(db_product)
    session.commit()
    session.refresh(db_product)
    opts = [link.option for link in db_product.attribute_links]
    return ProductRead(**db_product.model_dump(), attribute_options=opts)

@app.delete("/products/{product_id}")
def delete_product(product_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_products"]))):
    db_product = session.get(Product, product_id)
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    try:
        session.delete(db_product)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="無法刪除商品：該商品已被使用（如採購單或銷售單），請先移除相關單據。")
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"刪除失敗: {str(e)}")
        
    return {"ok": True}

# Product Listings API
def _get_published_listing_quantities(session: Session) -> dict[int, int]:
    """已發布(published)批次中，每個商品目前佔用的上架數量加總。

    封存(archived)批次不計入——封存視為下架，數量歸還可上架庫存。
    """
    query = (
        select(ProductListingItem.product_id, sa_func.sum(ProductListingItem.quantity))
        .join(ProductListingBatch, ProductListingItem.batch_id == ProductListingBatch.id)
        .where(ProductListingBatch.status == "published")
        .group_by(ProductListingItem.product_id)
    )
    return {product_id: int(total) for product_id, total in session.exec(query).all()}


def _build_product_listing_batch_read(
    batch: ProductListingBatch,
    session: Session,
    skip: int = 0,
    limit: int = 5000,
):
    creator = session.get(User, batch.created_by_id)
    creator_name = creator.full_name or creator.username if creator else "System"

    query = (
        select(ProductListingItem)
        .where(ProductListingItem.batch_id == batch.id)
        .offset(skip)
        .limit(limit)
    )
    db_items = session.exec(query).all()

    items_read = []
    for item in db_items:
        product = session.get(Product, item.product_id)
        if product:
            items_read.append(
                ProductListingItemRead(
                    id=item.id,
                    batch_id=batch.id,
                    product_id=item.product_id,
                    quantity=item.quantity,
                    product_sku=product.sku or "",
                    product_name=product.name or "",
                    sales_price=product.sales_price or 0.0,
                    stock_quantity=product.stock_quantity or 0,
                    image_url=product.image_url,
                )
            )

    return ProductListingBatchRead(
        id=batch.id,
        created_at=batch.created_at,
        created_by_id=batch.created_by_id,
        created_by_name=creator_name,
        status=batch.status,
        published_at=batch.published_at,
        archived_at=batch.archived_at,
        items=items_read,
    )


@app.post("/product-listings/", response_model=ProductListingBatchRead)
def create_product_listing(
    listing: ProductListingCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["create_product_listings"]))
):
    reserved = _get_published_listing_quantities(session)

    for item in listing.items:
        product = session.get(Product, item.product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"商品 (id={item.product_id}) 不存在")
        available = (product.stock_quantity or 0) - reserved.get(item.product_id, 0)
        if item.quantity > available:
            raise HTTPException(
                status_code=400,
                detail=f"「{product.name}」可上架數量不足：目前庫存 {product.stock_quantity or 0}，"
                       f"已有 {reserved.get(item.product_id, 0)} 件在已發布批次中，"
                       f"可上架 {max(available, 0)} 件，但本次要求 {item.quantity} 件",
            )

    batch = ProductListingBatch(created_by_id=current_user.id, status="draft")
    session.add(batch)
    session.commit()
    session.refresh(batch)

    for item in listing.items:
        db_item = ProductListingItem(
            batch_id=batch.id,
            product_id=item.product_id,
            quantity=item.quantity
        )
        session.add(db_item)
    session.commit()

    return _build_product_listing_batch_read(batch, session=session, skip=0, limit=5000)


@app.get("/product-listings/", response_model=List[ProductListingBatchRead])
def list_product_listings(
    skip: int = 0,
    limit: int = 100,
    status: str | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_product_listings"]))
):
    query = select(ProductListingBatch).order_by(ProductListingBatch.created_at.desc())
    if status:
        query = query.where(ProductListingBatch.status == status)
    batches = session.exec(query.offset(skip).limit(limit)).all()
    return [_build_product_listing_batch_read(batch, session=session) for batch in batches]


@app.get("/product-listings/reserved-quantities", response_model=Dict[int, int])
def get_product_listing_reserved_quantities(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_product_listings"]))
):
    """每個商品目前在「已發布」批次中佔用的數量，供建立新批次時計算可上架庫存。"""
    return _get_published_listing_quantities(session)


@app.get("/product-listings/{batch_id}", response_model=ProductListingBatchRead)
def get_product_listing(
    batch_id: int, 
    skip: int = 0, 
    limit: int = 5000, 
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_product_listings"]))
):
    batch = session.get(ProductListingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _build_product_listing_batch_read(batch, session=session, skip=skip, limit=limit)


@app.post("/product-listings/{batch_id}/publish", response_model=ProductListingBatchRead)
def publish_product_listing(
    batch_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["edit_product_listings"]))
):
    batch = session.get(ProductListingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status == "archived":
        raise HTTPException(status_code=400, detail="Archived batch cannot be published")

    batch.status = "published"
    batch.published_at = datetime.now()
    batch.archived_at = None
    session.add(batch)
    session.commit()
    session.refresh(batch)
    return _build_product_listing_batch_read(batch, session=session)


@app.post("/product-listings/{batch_id}/archive", response_model=ProductListingBatchRead)
def archive_product_listing(
    batch_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["edit_product_listings"]))
):
    batch = session.get(ProductListingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch.status = "archived"
    batch.archived_at = datetime.now()
    session.add(batch)
    session.commit()
    session.refresh(batch)
    return _build_product_listing_batch_read(batch, session=session)


@app.get("/products/generate_sku/")
def generate_sku(session: Session = Depends(get_session)):
    while True:
        # Generate random SKU: SKU- + 8 random uppercase/digits
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        sku = f"SKU-{suffix}"
        
        # Check uniqueness
        existing = session.exec(select(Product).where(Product.sku == sku)).first()
        if not existing:
            return {"sku": sku}

# Category API
@app.post("/categories/", response_model=Category)
def create_category(category: CategoryBase, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_categories"]))):
    try:
        db_category = Category.model_validate(category)
        session.add(db_category)
        session.commit()
        session.refresh(db_category)
        return db_category
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Category with this name already exists")

@app.get("/categories/", response_model=List[Category])
def read_categories(offset: int = 0, limit: int = 100, session: Session = Depends(get_session)):
    categories = session.exec(select(Category).offset(offset).limit(limit)).all()
    return categories

@app.delete("/categories/{category_id}")
def delete_category(category_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_categories"]))):
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    session.delete(category)
    session.commit()
    return {"ok": True}

# Supplier API
@app.post("/suppliers/", response_model=SupplierRead)
def create_supplier(supplier: SupplierBase, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_suppliers"]))):
    try:
        db_supplier = Supplier.model_validate(supplier)
        session.add(db_supplier)
        session.commit()
        session.refresh(db_supplier)
        return to_supplier_read(db_supplier)
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Supplier with this name already exists")

@app.get("/suppliers/", response_model=List[SupplierRead])
def read_suppliers(
    offset: int = 0, 
    limit: int = 100, 
    name: Optional[str] = None,
    category: Optional[str] = None,
    grade: Optional[str] = None,
    session: Session = Depends(get_session)
):
    query = select(Supplier)
    
    if name:
        query = query.where(Supplier.name.contains(name))
    
    if category:
        query = query.where(Supplier.category == category)
        
    suppliers = [to_supplier_read(s) for s in session.exec(query.offset(offset).limit(limit)).all()]
    # 等級由評分推導、不存 DB，只能在查出來之後篩
    if grade:
        suppliers = [s for s in suppliers if s.grade == grade.upper()]
    
    # Operation Log
    if name or category or grade:
        print(f"[LOG] Search/Filter Supplier: name='{name}', category='{category}', grade='{grade}' at {datetime.now()}")
        
    return suppliers

@app.get("/suppliers/{supplier_id}/rating_logs", response_model=List[SupplierRatingLog])
def read_supplier_rating_logs(supplier_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_suppliers"]))):
    if not session.get(Supplier, supplier_id):
        raise HTTPException(status_code=404, detail="Supplier not found")
    return session.exec(
        select(SupplierRatingLog)
        .where(SupplierRatingLog.supplier_id == supplier_id)
        .order_by(SupplierRatingLog.created_at.desc(), SupplierRatingLog.id.desc())
    ).all()

@app.patch("/suppliers/{supplier_id}", response_model=SupplierRead)
def update_supplier(supplier_id: int, supplier_update: SupplierUpdate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_suppliers"]))):
    db_supplier = session.get(Supplier, supplier_id)
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    supplier_data = supplier_update.model_dump(exclude_unset=True)
    new_rating = supplier_data.pop("rating", None)
    rating_reason = supplier_data.pop("rating_reason", None)
    if new_rating is not None:
        apply_manual_rating(session, db_supplier, new_rating, rating_reason, current_user.full_name or current_user.username)
    
    # If note is being updated, update the timestamp
    if "note" in supplier_data and supplier_data["note"] != db_supplier.note:
        supplier_data["note_updated_at"] = datetime.now()
        print(f"[LOG] Update Supplier Note: id={supplier_id} at {datetime.now()}")
        
    db_supplier.sqlmodel_update(supplier_data)
    session.add(db_supplier)
    session.commit()
    session.refresh(db_supplier)
    return to_supplier_read(db_supplier)

@app.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_suppliers"]))):
    supplier = session.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for log in session.exec(select(SupplierRatingLog).where(SupplierRatingLog.supplier_id == supplier_id)).all():
        session.delete(log)
    session.delete(supplier)
    session.commit()
    return {"ok": True}


@app.post("/products/ensure", response_model=ProductRead)
def ensure_product(product: ProductCreate, session: Session = Depends(get_session)):
    # Check if SKU exists
    statement = select(Product).where(Product.sku == product.sku)
    existing_product = session.exec(statement).first()
    
    if existing_product:
        # Update existing product with new details
        # We assume the PO creation intent includes updating product details (e.g. latest cost)
        product_data = product.model_dump(exclude_unset=True)
        
        # Protect stock_quantity from being reset if it's 0 in the payload
        # But if the payload has 0, it means we probably don't know the stock.
        # ProductBase has default 0.
        # We should NOT update stock_quantity from here, as this is metadata update.
        if "stock_quantity" in product_data:
             del product_data["stock_quantity"]
             
        # Handle attribute_option_ids
        if "attribute_option_ids" in product_data:
            opt_ids = product_data.pop("attribute_option_ids")
            if opt_ids is not None:
                # Clear existing
                for link in list(existing_product.attribute_links):
                    session.delete(link)
                # Add new
                for opt_id in opt_ids:
                    session.add(ProductAttributeLink(product_id=existing_product.id, option_id=opt_id))

        existing_product.sqlmodel_update(product_data)
        session.add(existing_product)
        session.commit()
        session.refresh(existing_product)
        opts = [link.option for link in existing_product.attribute_links]
        return ProductRead(**existing_product.model_dump(), attribute_options=opts)
    else:
        # Create new
        db_product = Product.model_validate(product)
        session.add(db_product)
        session.commit()
        session.refresh(db_product)
        
        if product.attribute_option_ids:
            for opt_id in product.attribute_option_ids:
                link = ProductAttributeLink(product_id=db_product.id, option_id=opt_id)
                session.add(link)
            session.commit()
            session.refresh(db_product)
            
        opts = [link.option for link in db_product.attribute_links]
        return ProductRead(**db_product.model_dump(), attribute_options=opts)

def _add_auto_transaction(session: Session, current_user: User, request: Optional[Request], tx: Transaction):
    """單據流程自動記帳（採購入庫、出貨、退貨完成）。經手人不需要記帳權限——單據權限把關、
    金額一律由後端依單據算——但每一筆都寫進系統日誌，經手人沒有記帳權限時特別標註。只 add 不 commit。"""
    session.add(tx)
    note = "" if has_any_permission(current_user, ["create_finance"]) else "（經手人沒有記帳權限，由單據流程自動記帳）"
    kind = "收入" if tx.type == "income" else "支出"
    add_log(session, current_user, request, "auto_transaction", "transactions",
            f"自動記帳：{kind} {tx.category} {tx.amount:g}，來源 {tx.reference_id}{note}")


def _ensure_valid_lines(items, label: str):
    """單據品項的數量要大於 0、單價不可為負——金額會直接進自動記帳。"""
    for item in items or []:
        if item.quantity is None or item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"{label}品項數量必須大於 0")
        if item.unit_price is None or item.unit_price < 0:
            raise HTTPException(status_code=400, detail=f"{label}品項單價不可為負數")


def _lines_total(items) -> float:
    return round(sum(item.quantity * item.unit_price for item in items), 2)


# Purchase Order API
def _ensure_receiving_only_update(db_po: PurchaseOrder, po_update: PurchaseOrderUpdate):
    """「確認入庫」只能把狀態改成 received、填實收數量／短收原因／驗收照片，不能改品項、數量、單價或其他欄位。
    只有驗收權限（edit_receiving）的人只能做這件事；有採購單編輯權限的人對已鎖定的採購單做入庫也一樣
    ——要改內容得走簽呈。"""
    fields = set(po_update.model_dump(exclude_unset=True).keys())
    if po_update.status != "received" or not fields <= {"status", "items", "received_by"}:
        raise HTTPException(status_code=403, detail="確認入庫時只能填驗收資料，不能修改採購單內容")
    if po_update.items is not None:
        # 驗收頁只送出已確認商品的品項，所以是原品項的子集合，不一定全部都在
        original = Counter((i.product_id, i.quantity, i.unit_price) for i in db_po.items)
        submitted = Counter((i.product_id, i.quantity, i.unit_price) for i in po_update.items)
        if submitted - original:
            raise HTTPException(status_code=403, detail="確認入庫時不能修改採購品項、數量或單價")

@app.post("/purchase_orders/", response_model=PurchaseOrder)
def create_po(po: PurchaseOrderCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_purchase_orders"]))):
    _ensure_valid_lines(po.items, "採購")
    if po.total_amount is not None and po.total_amount < 0:
        raise HTTPException(status_code=400, detail="採購金額不可為負數")
    try:
        db_po = create_purchase_order(
            session, po,
            purchaser_name=current_user.full_name or current_user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if db_po.status == "received":
        binding = session.get(UserLineBinding, current_user.id)
        if binding:
            push_line_message_sync(binding.line_user_id, build_purchase_received_message(db_po), message_type="purchase_received")

    return db_po

@app.get("/purchase_orders/", response_model=List[PurchaseOrderRead])
def read_pos(offset: int = 0, limit: int = 100, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_purchase_orders", "view_receiving"]))):
    pos = session.exec(select(PurchaseOrder).offset(offset).limit(limit)).all()
    return pos

@app.patch("/purchase_orders/{po_id}", response_model=PurchaseOrder)
def update_po(po_id: int, po_update: PurchaseOrderUpdate, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_purchase_orders", "edit_receiving"]))):
    db_po = session.get(PurchaseOrder, po_id)
    if not db_po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    ensure_not_voided(db_po, "採購單")
    # 已入庫的採購單已經加了庫存、記了採購支出：再改（例如改回已完成再入庫一次）會重複入庫、重複記帳
    if db_po.status == "received":
        raise HTTPException(status_code=400, detail="已入庫的採購單不可修改；短收請走補驗收單，金額有誤請由財務人員調整記帳")
    _ensure_valid_lines(po_update.items, "採購")
    if po_update.total_amount is not None and po_update.total_amount < 0:
        raise HTTPException(status_code=400, detail="採購金額不可為負數")
    if not has_any_permission(current_user, ["edit_purchase_orders"]):
        _ensure_receiving_only_update(db_po, po_update)
    elif db_po.status == "completed":
        # 已完成（待驗收）的採購單是鎖定的：確認入庫照常，其他修改要核准權限或簽呈批的臨時權限
        if po_update.status == "received":
            if not has_any_permission(current_user, ["approve_purchase_orders"]):
                _ensure_receiving_only_update(db_po, po_update)
        else:
            # 臨時權限只能改內容：改回草稿就等於永久解鎖，之後不用簽呈就能一直改
            if po_update.status not in (None, "completed") and not has_any_permission(current_user, ["approve_purchase_orders"]):
                raise HTTPException(status_code=403, detail="簽呈的臨時權限不能變更採購單狀態，需由核准人處理")
            changed = sorted(po_update.model_dump(exclude_unset=True).keys())
            summary = "變更欄位：" + "、".join(changed)
            if po_update.status and po_update.status != db_po.status:
                summary += f"（狀態 {db_po.status} → {po_update.status}）"
            authorize_locked_change(session, current_user, request, "purchase_order", po_id, "edit", summary)
    ensure_can_create_supplementary(current_user, po_update.items)
    
    previous_status = db_po.status

    # Update basic fields
    po_data = po_update.model_dump(exclude_unset=True, exclude={"items"})

    # Enforce the state machine: draft -> completed -> received. Skipping
    # straight to "received" would add stock and mark the product as
    # received (first_received_at) for a PO nobody actually verified via the
    # 進貨驗收作業 page — checked before any mutation so a rejected request
    # leaves the PO untouched.
    if po_data.get("status") == "received" and previous_status != "completed":
        raise HTTPException(
            status_code=400,
            detail="採購單必須先標記為「已完成」，才能在驗收作業中確認入庫",
        )

    # 實際驗收數量不可超過採購數量 — 檢查放在任何 mutation 之前，
    # 讓被拒絕的請求不會留下部分寫入的髒資料。
    if po_update.items is not None:
        for item_data in po_update.items:
            if (
                item_data.received_quantity is not None
                and item_data.received_quantity > item_data.quantity
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"品項（product_id={item_data.product_id}）實際驗收數量（{item_data.received_quantity}）不可超過採購數量（{item_data.quantity}）",
                )

    # 跟盤點一樣：確認入庫時，實際驗收少於採購數量的品項必須填短收原因，
    # 入庫後彙整成一則通知發給所有 admin。
    if po_data.get("status") == "received" and po_update.items is not None:
        missing_reason = [
            item_data.product_id
            for item_data in po_update.items
            if item_data.received_quantity is not None
            and item_data.received_quantity < item_data.quantity
            and not (item_data.shortage_reason and item_data.shortage_reason.strip())
        ]
        if missing_reason:
            names = []
            for product_id in missing_reason:
                product = session.get(Product, product_id)
                names.append(product.name if product else f"商品 #{product_id}")
            raise HTTPException(
                status_code=400,
                detail=f"以下品項實際驗收少於採購數量，請先填寫短收原因：{'、'.join(names)}",
            )

    db_po.sqlmodel_update(po_data)
    session.add(db_po) # Ensure main object is marked for update

    # Update Items if present
    if po_update.items is not None:
        # 驗收頁送回的項目不帶供應商，沒送這欄就保留原本項目的供應商
        previous_suppliers = {item.product_id: item.supplier_name for item in db_po.items}

        # 1. Remove existing items
        for item in db_po.items:
            session.delete(item)
        
        # 2. Add new items
        new_items = []
        for item_data in po_update.items:
            supplier = (
                (item_data.supplier_name or "").strip() or None
                if "supplier_name" in item_data.model_fields_set
                else previous_suppliers.get(item_data.product_id)
            )
            db_item = POItem(
                supplier_name=supplier,
                product_id=item_data.product_id,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                received_quantity=item_data.received_quantity,
                note=item_data.note,
                shortage_reason=item_data.shortage_reason,
                receiving_image=item_data.receiving_image,
                receiving_video=item_data.receiving_video,
                order_id=db_po.id
            )
            session.add(db_item)
            new_items.append(db_item)
        db_po.supplier_name = summarize_suppliers(db_po.supplier_name, new_items)
    
    session.commit()
    session.refresh(db_po)

    # 改成已完成時，已確認訂購的商品若用了供應商管理還沒有的名稱，這時才正式建立供應商
    if ensure_suppliers_for_confirmed_items(session, db_po):
        session.commit()
        session.refresh(db_po)

    # Check if status changed to 'received' and update stock
    if previous_status != "received" and db_po.status == "received":
        for item in db_po.items:
             product = session.get(Product, item.product_id)
             if product:
                 qty_to_add = item.received_quantity if item.received_quantity is not None else item.quantity
                 product.stock_quantity += qty_to_add
                 if product.first_received_at is None:
                     product.first_received_at = datetime.now()
                 session.add(product)
                 # Log
                 log = InventoryLog(
                     product_id=product.id,
                     change_amount=qty_to_add,
                     change_type="purchase",
                     reference_id=f"PO-{db_po.id}"
                 )
                 session.add(log)
        
        # Create Transaction (Expense)
        _add_auto_transaction(session, current_user, request, Transaction(
            date=datetime.now(),
            type="expense",
            category="Purchase",
            amount=db_po.total_amount,
            description=f"採購單 #{db_po.id} 自動產生（供應商：{db_po.supplier_name}）",
            reference_id=f"PO-{db_po.id}",
            created_by=db_po.purchaser_name,
            handled_by=current_user.full_name or current_user.username,
        ))

        shortages = [
            item for item in db_po.items
            if item.received_quantity is not None and item.received_quantity < item.quantity
        ]
        if shortages:
            lines = []
            for item in shortages:
                product = item.product
                label = f"{product.name}（{product.sku}）" if product else f"商品 #{item.product_id}"
                diff = item.received_quantity - item.quantity
                lines.append(f"【短收】{label}：採購 {item.quantity} → 實收 {item.received_quantity}（{diff:+d}），原因：{(item.shortage_reason or '').strip()}")
            notify_admins(
                session,
                title=f"進貨短收通知：PO-{db_po.id}（{db_po.supplier_name}）",
                content=(
                    f"驗收人：{current_user.full_name or current_user.username}\n"
                    f"共 {len(shortages)} 項商品實收少於採購數量：\n" + "\n".join(lines)
                ),
                notification_type="receiving_shortage",
                link="/receiving",
            )
            # 短收自動扣供應商評分，並在供應商管理／建立採購單時標註
            apply_receiving_shortage(session, db_po, shortages, current_user.full_name or current_user.username)

        # 驗收時勾選「建立補驗收單」的短收品項，入庫同時建立補驗收單並通知 admin
        supplement_ids = {
            i.product_id for i in (po_update.items or [])
            if i.create_supplementary and i.received_quantity is not None and i.received_quantity < i.quantity
        }
        if supplement_ids:
            create_supplementary(session, db_po, current_user, supplement_ids)

        session.commit()
        session.refresh(db_po)

        binding = session.get(UserLineBinding, current_user.id)
        if binding:
            push_line_message_sync(binding.line_user_id, build_purchase_received_message(db_po), message_type="purchase_received")

    return db_po

class VoidRequest(BaseModel):
    reason: str


# 已完成以後的採購單不能刪除，只能報廢（backend/voiding.py；草稿用下面的 delete_po）。一般人送報廢簽呈（/change_requests/，action="void"），
# 有核准權限的主管可以直接報廢。
@app.post("/purchase_orders/{po_id}/void", response_model=PurchaseOrderRead)
def void_po(po_id: int, body: VoidRequest, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["approve_purchase_orders"]))):
    db_po = session.get(PurchaseOrder, po_id)
    if not db_po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    if db_po.void_status == "pending":
        raise HTTPException(status_code=400, detail="這張採購單已有報廢簽呈審核中，請到簽呈頁核准或駁回")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="請填寫報廢原因")
    void_purchase_order(session, db_po, current_user, request)
    db_po.void_reason = reason
    db_po.void_requested_by = current_user.full_name or current_user.username
    add_log(session, current_user, request, "void", "purchase_orders",
            f"以核准權限直接報廢 PO-{db_po.id}（供應商：{db_po.supplier_name}，金額：{db_po.total_amount}），原因：{reason}")
    session.commit()
    session.refresh(db_po)
    return db_po

# 草稿還沒動到庫存、記帳或供應商，直接刪除即可；改成已完成之後才只能報廢。
@app.delete("/purchase_orders/{po_id}")
def delete_po(po_id: int, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_purchase_orders"]))):
    db_po = session.get(PurchaseOrder, po_id)
    if not db_po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    ensure_not_voided(db_po, "採購單")
    if db_po.status != "draft":
        raise HTTPException(status_code=400, detail="只有草稿狀態的採購單可以刪除，已完成的採購單請改用報廢")
    for item in db_po.items:
        session.delete(item)
    add_log(session, current_user, request, "delete", "purchase_orders",
            f"刪除草稿採購單 PO-{db_po.id}（供應商：{db_po.supplier_name}，金額：{db_po.total_amount}）")
    session.delete(db_po)
    session.commit()
    return {"ok": True}

def deduct_stock_atomic(session: Session, product_id: int, quantity: int) -> Product:
    """原子性扣減庫存：庫存不足時拋 400，商品不存在時拋 404。回傳扣減後的 Product。"""
    result = session.execute(
        sa_update(Product)
        .where(Product.id == product_id, Product.stock_quantity >= quantity)
        .values(stock_quantity=Product.stock_quantity - quantity)
    )
    if result.rowcount == 0:
        product = session.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"商品 ID {product_id} 不存在")
        raise HTTPException(
            status_code=400,
            detail=f"「{product.name}」庫存不足，剩餘 {product.stock_quantity} 件，需要 {quantity} 件"
        )
    session.refresh(product := session.get(Product, product_id))
    return product

# Sales Order API
@app.post("/sales_orders/", response_model=SalesOrder)
def create_so(so: SalesOrderCreate, background_tasks: BackgroundTasks, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_shipping"]))):
    _ensure_valid_lines(so.items, "出貨")
    # 總金額一律由後端依品項計算，出貨時會直接記成收入，不能信任 client 傳來的值
    total_amount = _lines_total(so.items)
    # 1. Generate Order Number
    while True:
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        order_number = f"SO-{suffix}"
        if not session.exec(select(SalesOrder).where(SalesOrder.order_number == order_number)).first():
            break

    # 2. Calculate Totals
    total_quantity = sum(item.quantity for item in so.items)

    # 3. Create SO & Calculate Earned Points
    db_so = SalesOrder(
        order_number=order_number,
        customer_id=so.customer_id,
        member_id=so.member_id,
        platform=so.platform,
        order_date=so.order_date,
        # 新出貨單一律從「撿貨中」開始，由撿貨人員在撿貨分頁推進到已出貨；client 傳入的狀態會被忽略
        status="picking",
        total_amount=total_amount,
        total_quantity=total_quantity,
        # 出貨人一律由後端依登入者填寫（同 purchaser_name 的做法），client 傳入的值會被忽略
        shipped_by=current_user.full_name or current_user.username,
        shipping_date=so.shipping_date,
        # QRcode 只有蝦皮出貨單才有意義，其他平台一律不存
        shopee_qrcode_image=so.shopee_qrcode_image if so.platform == "shopee" else None,
        earned_points=int(total_amount // 100) if total_amount else 0
    )
    session.add(db_so)
    session.flush()  # 取得 db_so.id，但先不 commit：庫存不足時要讓整張單（含下方點數）一起 rollback

    # If member exists, add points to member immediately
    if db_so.member_id:
        member = session.get(Member, db_so.member_id)
        if member:
            before_balance = member.points
            member.points += db_so.earned_points
            session.add(member)

            # Log the transaction
            tx = PointTransactionLog(
                member_id=member.id,
                before_balance=before_balance,
                change_amount=db_so.earned_points,
                after_balance=member.points,
                reason=f"訂單回饋 (SO: {order_number})",
                transaction_type="order_bonus"
            )
            session.add(tx)

    # 4. Create Items and Deduct Stock (Always deduct on create; any item's stock shortage rolls back the whole order)
    for item in so.items:
        db_item = SOItem(
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            shipping_image=item.shipping_image,
            shipping_video=item.shipping_video,
            order_id=db_so.id
        )
        session.add(db_item)

        product = deduct_stock_atomic(session, item.product_id, item.quantity)
        log = InventoryLog(
            product_id=product.id,
            change_amount=-item.quantity,
            change_type="sale",
            reference_id=f"{order_number}"
        )
        session.add(log)

    # 通知所有 admin 有新出貨單；和出貨單同一個交易，庫存不足 rollback 時不會留下通知
    item_lines = []
    for item in so.items:
        product = session.get(Product, item.product_id)
        label = f"{product.name}（{product.sku}）" if product else f"商品 #{item.product_id}"
        item_lines.append(f"・{label} × {item.quantity}")
    message_text = build_sales_order_created_message(db_so, item_lines)
    notify_admins(
        session,
        title=f"出貨通知：{order_number}（{so.platform}）",
        content=message_text,
        notification_type="sales_order",
        link="/shipping",
    )

    session.commit()
    session.refresh(db_so)

    # LINE 推播給 admin 與撿貨人員：commit 成功後才送，放背景跑，避免每人最多 10 秒的推播拖慢回應
    for line_user_id in sales_order_line_recipients(session):
        background_tasks.add_task(push_line_message_sync, line_user_id, message_text, "sales_order_created")
    return db_so

@app.get("/sales_orders/", response_model=List[SalesOrderRead])
def read_sos(offset: int = 0, limit: int = 100, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_shipping"]))):
    sos = session.exec(select(SalesOrder).offset(offset).limit(limit)).all()
    return sos

@app.patch("/sales_orders/{so_id}", response_model=SalesOrder)
def update_so(so_id: int, so_update: SalesOrderUpdate, request: Request, background_tasks: BackgroundTasks, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_shipping"]))):
    db_so = session.get(SalesOrder, so_id)
    if not db_so:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    
    ensure_not_voided(db_so, "出貨單")
    previous_status = db_so.status
    before = _so_snapshot(session, db_so)

    # 已出貨的單已經記了收入：狀態不能退回出貨前（否則再出貨一次會重複記帳），品項與金額也不能再改
    if previous_status in SHIPPED_STATUSES:
        if so_update.status is not None and so_update.status not in SHIPPED_STATUSES:
            raise HTTPException(status_code=400, detail="已出貨的出貨單不能改回出貨前的狀態")
        if so_update.items is not None:
            raise HTTPException(status_code=400, detail="已出貨的出貨單不能修改商品或金額；有退貨請走退貨作業")
    _ensure_valid_lines(so_update.items, "出貨")

    # Update basic fields（總金額、總數量由後端依品項計算，client 傳入的值會被忽略）
    so_data = so_update.model_dump(exclude_unset=True, exclude={"items", "shipped_by", "total_amount", "total_quantity"})
    db_so.sqlmodel_update(so_data)
    if db_so.platform != "shopee":
        db_so.shopee_qrcode_image = None
    # 出貨人不可由 client 修改；舊單若沒有出貨人，補上本次操作的登入者
    if not db_so.shipped_by:
        db_so.shipped_by = current_user.full_name or current_user.username
    
    # Update Items if present
    if so_update.items is not None:
        # 1. Revert stock for existing items and remove them
        # We must collect the items to delete first to avoid iterating over a modifying list
        # And we need to be careful not to re-add deleted items to session via relationship
        
        # In SQLModel/SQLAlchemy, when we set db_so.items = [], it might try to nullify the FK 
        # on the child items first (causing NOT NULL constraint fail) before deleting them.
        # So instead of clearing the list, we should explicitly delete the items.
        
        existing_items = list(db_so.items)
        # 管理者修正出貨單時，商品與數量都沒變的列保留原本的撿貨進度；新增或改數量的列重新從撿貨中開始
        kept_picking = {}
        for item in existing_items:
            kept_picking.setdefault((item.product_id, item.quantity), []).append(item.picking_status)
        
        for item in existing_items:
            product = session.get(Product, item.product_id)
            if product:
                product.stock_quantity += item.quantity
                session.add(product)
                # Log Revert
                log = InventoryLog(
                    product_id=product.id, 
                    change_amount=item.quantity, 
                    change_type="sale_update_revert", 
                    reference_id=f"{db_so.order_number or ('SO-' + str(db_so.id))}"
                )
                session.add(log)
            session.delete(item)

        # Flush revert 的加回，讓後面的原子性扣庫存判斷基於「回沖後」的正確庫存
        session.flush()

        # 2. Add new items and deduct stock
        new_total_quantity = 0
        for item_data in so_update.items:
            new_total_quantity += item_data.quantity
            db_item = SOItem(
                product_id=item_data.product_id,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                shipping_image=item_data.shipping_image,
                shipping_video=item_data.shipping_video,
                picking_status=(kept_picking.get((item_data.product_id, item_data.quantity)) or ["picking"]).pop(0),
                order_id=db_so.id
            )
            session.add(db_item)

            product = deduct_stock_atomic(session, item_data.product_id, item_data.quantity)
            log = InventoryLog(
                product_id=product.id,
                change_amount=-item_data.quantity,
                change_type="sale_update_deduct",
                reference_id=f"{db_so.order_number or ('SO-' + str(db_so.id))}"
            )
            session.add(log)

        db_so.total_quantity = new_total_quantity
        db_so.total_amount = _lines_total(so_update.items)
        session.flush()
        # items 集合仍是刪除前的舊列，重新載入後才能依新列決定整單撿貨狀態
        session.expire(db_so, ["items"])
        _sync_order_picking_status(db_so)
    
    session.commit()
    session.refresh(db_so)
    
    # Check if status changed to 'shipped' (Income)
    # We trigger only once when it enters 'shipped' state.
    if previous_status not in SHIPPED_STATUSES and db_so.status in SHIPPED_STATUSES:
        _on_so_shipped(session, db_so, current_user, request)

    _notify_pickers_of_update(session, background_tasks, db_so, before, current_user)
    return db_so


ITEM_PICKING_LABELS = {"picking": "撿貨中", "picked": "已撿貨"}


def _sync_order_picking_status(db_so: SalesOrder):
    """撿貨中的出貨單，整單狀態依逐項撿貨狀態自動決定：全部已撿貨 → picked，否則 picking。"""
    if db_so.status not in ("pending", "picking", "picked"):
        return
    items = list(db_so.items)
    db_so.status = "picked" if items and all(i.picking_status == "picked" for i in items) else "picking"


SO_STATUS_LABELS = {"pending": "待出貨", "picking": "撿貨中", "picked": "撿貨完成", "shipped": "已出貨", "completed": "已完成"}


def _so_snapshot(session: Session, db_so: SalesOrder) -> dict:
    """出貨單要讓撿貨人員知道的欄位，更新前後各取一次來比對變更。"""
    item_lines = []
    for item in db_so.items:
        product = session.get(Product, item.product_id)
        label = f"{product.name}（{product.sku}）" if product else f"商品 #{item.product_id}"
        item_lines.append(f"・{label} × {item.quantity}（單價 {item.unit_price}）")
    return {
        "狀態": SO_STATUS_LABELS.get(db_so.status, db_so.status),
        "平台": db_so.platform,
        "客戶編號": db_so.customer_id,
        "總金額": db_so.total_amount,
        "出貨日期": db_so.shipping_date.strftime("%Y-%m-%d") if db_so.shipping_date else "-",
        "蝦皮出貨 QRcode": "已上傳" if db_so.shopee_qrcode_image else "未上傳",
        "出貨商品": "\n".join(item_lines),
        "撿貨進度": [(line.split("（單價")[0].lstrip("・"), ITEM_PICKING_LABELS.get(item.picking_status, item.picking_status)) for line, item in zip(item_lines, db_so.items)],
    }


def _notify_pickers_of_update(session: Session, background_tasks: BackgroundTasks, db_so: SalesOrder, before: dict, current_user: User):
    """出貨單有實際變更就推 LINE 給撿貨人員（不含修改者本人）；存檔但沒改任何東西則不推。呼叫前出貨單須已 commit。"""
    session.refresh(db_so)
    after = _so_snapshot(session, db_so)
    changes = []
    for key, old in before.items():
        new = after[key]
        if old == new:
            continue
        if key == "出貨商品":
            changes.append(f"出貨商品已修改，目前為：\n{new}")
        elif key == "撿貨進度":
            # 商品本身有改時上面已列出完整清單，這裡只報逐項撿貨狀態的變化
            if before["出貨商品"] == after["出貨商品"]:
                changes.extend(f"・{label}：{o} → {n}" for (label, o), (_, n) in zip(old, new) if o != n)
        elif key == "蝦皮出貨 QRcode" and new == "已上傳":
            changes.append("蝦皮出貨 QRcode：已更新")
        else:
            changes.append(f"{key}：{old} → {new}")
    if not changes:
        return
    text = build_sales_order_updated_message(db_so, current_user.full_name or current_user.username, changes)
    for line_user_id in picker_line_recipients(session, exclude_user_id=current_user.id):
        background_tasks.add_task(push_line_message_sync, line_user_id, text, "sales_order_updated")


SHIPPED_STATUSES = ("shipped", "completed")


def _on_so_shipped(session: Session, db_so: SalesOrder, current_user: User, request: Optional[Request] = None):
    """出貨單第一次進入 shipped 時的副作用：自動記一筆收入，並推 LINE 給操作者。呼叫前出貨單須已 commit。"""
    _add_auto_transaction(session, current_user, request, Transaction(
        date=datetime.now(),
        type="income",
        category="Sales",
        amount=db_so.total_amount,
        description=f"出貨單 {db_so.order_number} 自動產生（客戶：{db_so.customer_id}）",
        reference_id=f"SO-{db_so.id}",
        created_by=db_so.shipped_by,
        handled_by=current_user.full_name or current_user.username,
    ))
    session.commit()
    session.refresh(db_so)

    binding = session.get(UserLineBinding, current_user.id)
    if binding:
        push_line_message_sync(binding.line_user_id, build_sale_shipped_message(db_so), message_type="sale_shipped")


# 撿貨分頁：撿貨人員只能改狀態（逐項撿貨、整單出貨），商品、數量、金額一律不能動
class PickingStatusUpdate(BaseModel):
    status: str


@app.patch("/sales_orders/{so_id}/items/{item_id}/picking_status", response_model=SalesOrderRead)
def update_item_picking_status(so_id: int, item_id: int, body: PickingStatusUpdate, background_tasks: BackgroundTasks, session: Session = Depends(get_session), current_user: User = Depends(require_picker_or(["edit_shipping"]))):
    db_so = session.get(SalesOrder, so_id)
    item = session.get(SOItem, item_id)
    if not db_so or not item or item.order_id != db_so.id:
        raise HTTPException(status_code=404, detail="Sales Order item not found")
    ensure_not_voided(db_so, "出貨單")
    if body.status not in ITEM_PICKING_LABELS:
        raise HTTPException(status_code=400, detail="商品撿貨狀態只能是 撿貨中 / 已撿貨")
    if db_so.status not in ("pending", "picking", "picked"):
        raise HTTPException(status_code=400, detail="此出貨單已出貨，不能再修改撿貨狀態")

    before = _so_snapshot(session, db_so)
    item.picking_status = body.status
    session.add(item)
    session.flush()
    _sync_order_picking_status(db_so)
    session.add(db_so)
    session.commit()

    _notify_pickers_of_update(session, background_tasks, db_so, before, current_user)
    return db_so


@app.patch("/sales_orders/{so_id}/picking_status", response_model=SalesOrderRead)
def update_picking_status(so_id: int, body: PickingStatusUpdate, request: Request, background_tasks: BackgroundTasks, session: Session = Depends(get_session), current_user: User = Depends(require_picker_or(["edit_shipping"]))):
    db_so = session.get(SalesOrder, so_id)
    if not db_so:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    ensure_not_voided(db_so, "出貨單")
    # 整單的撿貨中／撿貨完成由逐項撿貨狀態自動決定，這裡只能把全部撿完的單改成已出貨
    if body.status != "shipped":
        raise HTTPException(status_code=400, detail="整張出貨單只能改為已出貨；撿貨進度請逐項商品設定")
    if db_so.status not in ("pending", "picking", "picked"):
        raise HTTPException(status_code=400, detail="此出貨單已出貨，不能再修改撿貨狀態")
    if not db_so.items or any(i.picking_status != "picked" for i in db_so.items):
        raise HTTPException(status_code=400, detail="還有商品沒撿完，全部商品都已撿貨後才能出貨")

    previous_status = db_so.status
    before = _so_snapshot(session, db_so)
    db_so.status = body.status
    if body.status == "shipped" and not db_so.shipping_date:
        db_so.shipping_date = datetime.now()
    session.add(db_so)
    session.commit()
    session.refresh(db_so)

    if previous_status not in SHIPPED_STATUSES and db_so.status in SHIPPED_STATUSES:
        _on_so_shipped(session, db_so, current_user, request)
    _notify_pickers_of_update(session, background_tasks, db_so, before, current_user)
    return db_so

# 出貨單不能刪除，只能報廢（同採購單）
@app.post("/sales_orders/{so_id}/void", response_model=SalesOrderRead)
def void_so(so_id: int, body: VoidRequest, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["approve_shipping"]))):
    db_so = session.get(SalesOrder, so_id)
    if not db_so:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    if db_so.void_status == "pending":
        raise HTTPException(status_code=400, detail="這張出貨單已有報廢簽呈審核中，請到簽呈頁核准或駁回")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="請填寫報廢原因")
    void_sales_order(session, db_so, current_user, request)
    db_so.void_reason = reason
    db_so.void_requested_by = current_user.full_name or current_user.username
    add_log(session, current_user, request, "void", "sales_orders",
            f"以核准權限直接報廢 {db_so.order_number}（客戶：{db_so.customer_id}，金額：{db_so.total_amount}），原因：{reason}")
    session.commit()
    session.refresh(db_so)
    return db_so

# Inventory API
@app.get("/inventory/logs/", response_model=List[InventoryLog])
def read_inventory_logs(offset: int = 0, limit: int = 100, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_products"]))):
    logs = session.exec(select(InventoryLog).offset(offset).limit(limit)).all()
    return logs

@app.get("/dashboard/stats")
def get_dashboard_stats(session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_dashboard"]))):
    total_products = session.exec(select(Product)).all()
    total_pos = session.exec(select(PurchaseOrder)).all()
    total_sos = session.exec(select(SalesOrder)).all()

    # Only count products that have actually been received at least once —
    # a product row exists as soon as a PO (even a draft) references its SKU,
    # so counting all of them here would inflate SKU/low-stock counts with
    # items still sitting in an unreceived purchase order.
    received_products = [p for p in total_products if p.first_received_at is not None]
    low_stock_products = [p for p in received_products if p.stock_quantity <= p.safety_stock]

    return {
        "total_sku": len(received_products),
        "total_po_count": len(total_pos),
        "total_so_count": len(total_sos),
        "low_stock_count": len(low_stock_products),
        "total_inventory_value": sum([p.stock_quantity * p.cost_price for p in received_products]),
        "sales_trend": _dashboard_sales_trend(total_sos, {p.id: p for p in total_products}),
        "recent_orders": _dashboard_recent_orders(total_sos),
    }


DASHBOARD_TREND_MONTHS = 7


def _dashboard_sales_trend(sales_orders, products_by_id, now: Optional[datetime] = None):
    """總覽的銷售趨勢：最近 7 個月（含本月）每月的銷售額與成本。

    只算已出貨／已完成、沒被報廢的出貨單，歸在出貨日那個月（舊資料沒有出貨日就用下單日），
    和記帳在出貨時才記銷售收入的時間點一致。成本 = 數量 × 商品目前的成本價（出貨單沒有留成本快照）。
    """
    now = now or datetime.now()
    months = []
    year, month = now.year, now.month
    for _ in range(DASHBOARD_TREND_MONTHS):
        months.append((year, month))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    months.reverse()
    buckets = {key: {"sales": 0.0, "cost": 0.0} for key in months}

    for so in sales_orders:
        if so.status not in SHIPPED_STATUSES or so.void_status == "voided":
            continue
        when = so.shipping_date or so.order_date
        bucket = buckets.get((when.year, when.month)) if when else None
        if bucket is None:
            continue
        bucket["sales"] += so.total_amount or 0
        for item in so.items:
            product = products_by_id.get(item.product_id)
            bucket["cost"] += item.quantity * (product.cost_price if product else 0)

    return [
        {"month": f"{y}-{m:02d}", "sales": round(buckets[(y, m)]["sales"], 2), "cost": round(buckets[(y, m)]["cost"], 2)}
        for y, m in months
    ]


def _dashboard_recent_orders(sales_orders, limit: int = 5):
    """總覽的近期訂單：最新 5 張出貨單（含報廢的，前端會標示）。"""
    latest = sorted(sales_orders, key=lambda so: (so.order_date or datetime.min, so.id or 0), reverse=True)[:limit]
    return [
        {
            "id": so.id,
            "order_number": so.order_number,
            "customer": so.member.name if so.member else so.customer_id,
            "total_amount": so.total_amount,
            "status": so.status,
            "void_status": so.void_status,
            "order_date": so.order_date,
        }
        for so in latest
    ]

# Return Order API
RETURN_TYPES = ("return", "refund_only")


def _validate_return_order(return_type: str, items: list, total_refund_amount: float, note: Optional[str]):
    """退貨退款必須有商品；僅退款不可帶商品，且要填退款金額與原因。"""
    if return_type not in RETURN_TYPES:
        raise HTTPException(status_code=400, detail="退貨類型只能是退貨退款或僅退款")
    if return_type == "return":
        if not items:
            raise HTTPException(status_code=400, detail="退貨退款至少要有一項退貨商品；若只退款不退貨，請選擇「僅退款」")
    else:
        if items:
            raise HTTPException(status_code=400, detail="僅退款不可包含退貨商品")
        if not total_refund_amount or total_refund_amount <= 0:
            raise HTTPException(status_code=400, detail="僅退款的退款金額必須大於 0")
        if not (note or "").strip():
            raise HTTPException(status_code=400, detail="僅退款必須填寫退款原因")


def _ensure_refund_within_order(session: Session, order_id: Optional[int], amount: float, exclude_ro_id: Optional[int] = None):
    """有連結出貨單時，這張單所有退貨單的退款合計不可超過出貨單金額——退款會直接記成支出。"""
    if not order_id:
        return
    so = session.get(SalesOrder, order_id)
    if not so:
        raise HTTPException(status_code=400, detail="連結的出貨單不存在")
    others = session.exec(select(ReturnOrder).where(ReturnOrder.order_id == order_id)).all()
    # 已報廢的退貨單退款已經沖銷，不算進已退金額
    refunded = sum(ro.total_refund_amount or 0 for ro in others if ro.id != exclude_ro_id and ro.void_status != "voided")
    if refunded + amount > (so.total_amount or 0) + 0.005:
        raise HTTPException(
            status_code=400,
            detail=f"退款金額超過出貨單 {so.order_number} 的金額（出貨 {so.total_amount:g}，其他退貨單已退 {refunded:g}）",
        )


def _on_return_completed(session: Session, db_ro: ReturnOrder, current_user: User, request: Optional[Request] = None):
    """退貨單變成已完成：商品加回庫存（配 InventoryLog），並記一筆退款支出。呼叫端負責 commit。"""
    item_details_list = []
    for item in db_ro.items:
        product = session.get(Product, item.product_id)
        if product:
            product.stock_quantity += item.quantity
            session.add(product)
            session.add(InventoryLog(
                product_id=product.id,
                change_amount=item.quantity,
                change_type="return",
                reference_id=db_ro.return_number
            ))
        p_name = product.name if product else f"Product {item.product_id}"
        item_details_list.append(f"{p_name} x{item.quantity}")

    if db_ro.return_type == "refund_only":
        description = f"退貨單 {db_ro.return_number} 自動產生。僅退款：{db_ro.note or ''}"
    else:
        description = f"退貨單 {db_ro.return_number} 自動產生。品項：{'、'.join(item_details_list)}"
    _add_auto_transaction(session, current_user, request, Transaction(
        date=datetime.now(),
        type="expense",
        category="Refund",
        amount=db_ro.total_refund_amount,
        description=description,
        reference_id=f"RO-{db_ro.id}",
        created_by=db_ro.handled_by,
        handled_by=current_user.full_name or current_user.username,
    ))


@app.post("/return_orders/", response_model=ReturnOrder)
def create_return_order(ro: ReturnOrderCreate, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_returns"]))):
    _ensure_valid_lines(ro.items, "退貨")
    # 退貨退款的金額一律由後端依退貨品項計算；僅退款才用使用者輸入的金額
    if ro.return_type == "return":
        ro.total_refund_amount = _lines_total(ro.items)
    _validate_return_order(ro.return_type, ro.items, ro.total_refund_amount, ro.note)
    _ensure_refund_within_order(session, ro.order_id, ro.total_refund_amount)

    # 1. Generate Return Number
    while True:
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        return_number = f"RO-{suffix}"
        if not session.exec(select(ReturnOrder).where(ReturnOrder.return_number == return_number)).first():
            break

    # 2. Create Return Order（經辦人一律取登入者，不信任前端傳值）
    db_ro = ReturnOrder(
        return_number=return_number,
        order_id=ro.order_id,
        customer_id=ro.customer_id,
        return_date=ro.return_date,
        status=ro.status,
        return_type=ro.return_type,
        total_refund_amount=ro.total_refund_amount,
        note=ro.note,
        handled_by=current_user.full_name or current_user.username
    )
    session.add(db_ro)
    session.commit()
    session.refresh(db_ro)

    # 3. Create Items
    for item in ro.items:
        session.add(ReturnItem(
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            reason=item.reason,
            return_image=item.return_image,
            return_video=item.return_video,
            return_order_id=db_ro.id
        ))
    session.commit()
    session.refresh(db_ro)

    # If created as completed (rare), update stock and record the refund
    if db_ro.status == "completed":
        _on_return_completed(session, db_ro, current_user, request)
        session.commit()
        session.refresh(db_ro)
    return db_ro

@app.get("/return_orders/", response_model=List[ReturnOrderRead])
def read_return_orders(offset: int = 0, limit: int = 100, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_returns"]))):
    ros = session.exec(select(ReturnOrder).offset(offset).limit(limit)).all()
    return ros

@app.get("/return_orders/{ro_id}", response_model=ReturnOrder)
def read_return_order(ro_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_returns"]))):
    ro = session.get(ReturnOrder, ro_id)
    if not ro:
        raise HTTPException(status_code=404, detail="Return Order not found")
    return ro

@app.patch("/return_orders/{ro_id}", response_model=ReturnOrder)
def update_return_order(ro_id: int, ro_update: ReturnOrderUpdate, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_returns"]))):
    db_ro = session.get(ReturnOrder, ro_id)
    if not db_ro:
        raise HTTPException(status_code=404, detail="Return Order not found")
    
    ensure_not_voided(db_ro, "退貨單")
    previous_status = db_ro.status
    if previous_status == "completed":
        raise HTTPException(status_code=400, detail="已完成的退貨單不可修改")

    # 送出後的最終狀態要通過同一套檢查（例如切成僅退款時，商品必須清空）
    final_type = ro_update.return_type if ro_update.return_type is not None else db_ro.return_type
    final_items = ro_update.items if ro_update.items is not None else db_ro.items
    _ensure_valid_lines(ro_update.items, "退貨")
    if final_type == "return":
        # 退貨退款的金額一律由後端依退貨品項計算
        ro_update.total_refund_amount = _lines_total(final_items)
    final_amount = ro_update.total_refund_amount if ro_update.total_refund_amount is not None else db_ro.total_refund_amount
    final_note = ro_update.note if "note" in ro_update.model_fields_set else db_ro.note
    _validate_return_order(final_type, final_items, final_amount, final_note)
    _ensure_refund_within_order(session, db_ro.order_id, final_amount, exclude_ro_id=db_ro.id)

    # Update basic fields
    ro_data = ro_update.model_dump(exclude_unset=True, exclude={"items"})
    db_ro.sqlmodel_update(ro_data)
    if not db_ro.handled_by:
        db_ro.handled_by = current_user.full_name or current_user.username
    session.add(db_ro)

    # Update Items if present
    if ro_update.items is not None:
        for item in db_ro.items:
            session.delete(item)
        for item_data in ro_update.items:
            session.add(ReturnItem(
                product_id=item_data.product_id,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                reason=item_data.reason,
                return_image=item_data.return_image,
                return_video=item_data.return_video,
                return_order_id=db_ro.id
            ))

    session.commit()
    # 刪除再新增後 relationship 集合可能是舊的
    session.expire(db_ro, ["items"])
    session.refresh(db_ro)

    if db_ro.status == "completed":
        _on_return_completed(session, db_ro, current_user, request)
        session.commit()
        session.refresh(db_ro)

    return db_ro

# 退貨單不能刪除，只能報廢（同採購單、出貨單）：一般人送報廢簽呈，有核准權限的主管可以直接報廢
@app.post("/return_orders/{ro_id}/void", response_model=ReturnOrder)
def void_ro(ro_id: int, body: VoidRequest, request: Request, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["approve_returns"]))):
    db_ro = session.get(ReturnOrder, ro_id)
    if not db_ro:
        raise HTTPException(status_code=404, detail="Return Order not found")
    if db_ro.void_status == "pending":
        raise HTTPException(status_code=400, detail="這張退貨單已有報廢簽呈審核中，請到簽呈頁核准或駁回")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="請填寫報廢原因")
    void_return_order(session, db_ro, current_user, request)
    db_ro.void_reason = reason
    db_ro.void_requested_by = current_user.full_name or current_user.username
    add_log(session, current_user, request, "void", "return_orders",
            f"以核准權限直接報廢 {db_ro.return_number}（客戶：{db_ro.customer_id or '-'}，退款金額：{db_ro.total_refund_amount:g}），原因：{reason}")
    session.commit()
    session.refresh(db_ro)
    return db_ro

# Stock Take API
@app.post("/stock_takes/", response_model=StockTakeRead)
def create_stock_take(stock_take: StockTakeCreate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["create_stock_takes"]))):
    # Create StockTake record
    db_stock_take = StockTake.model_validate(stock_take)
    db_stock_take.taker_name = current_user.full_name or current_user.username
    db_stock_take.completed_by_name = None
    db_stock_take.status = "draft"
    session.add(db_stock_take)
    session.commit()
    session.refresh(db_stock_take)
    
    # Snapshot all products
    products = session.exec(select(Product)).all()
    for product in products:
        if product.stock_quantity == 0:
            continue
        item = StockTakeItem(
            stock_take_id=db_stock_take.id,
            product_id=product.id,
            system_quantity=product.stock_quantity,
            actual_quantity=product.stock_quantity # Default to system quantity
        )
        session.add(item)
    
    session.commit()
    session.refresh(db_stock_take)
    return db_stock_take

@app.get("/stock_takes/", response_model=List[StockTakeRead])
def read_stock_takes(
    offset: int = 0, 
    limit: int = 100, 
    status: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_stock_takes"])),
):
    query = select(StockTake)
    
    if status:
        query = query.where(StockTake.status == status)
    
    if start_date:
        query = query.where(StockTake.created_at >= start_date)
        
    if end_date:
        query = query.where(StockTake.created_at <= end_date)
        
    stock_takes = session.exec(query.offset(offset).limit(limit).order_by(StockTake.created_at.desc())).all()
    return stock_takes

@app.get("/stock_takes/{st_id}", response_model=StockTakeRead)
def read_stock_take(st_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["view_stock_takes"]))):
    stock_take = session.get(StockTake, st_id)
    if not stock_take:
        raise HTTPException(status_code=404, detail="Stock Take not found")
    return stock_take

@app.patch("/stock_takes/{st_id}", response_model=StockTakeRead)
def update_stock_take(st_id: int, st_update: StockTakeUpdate, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_stock_takes"]))):
    db_st = session.get(StockTake, st_id)
    if not db_st:
        raise HTTPException(status_code=404, detail="Stock Take not found")
        
    if db_st.status == "completed":
        raise HTTPException(status_code=400, detail="Cannot update completed stock take")
    
    st_data = st_update.model_dump(exclude_unset=True, exclude={"items"})
    db_st.sqlmodel_update(st_data)
    
    if st_update.items:
        for item_update in st_update.items:
            # We can find item by product_id + st_id or by item id if provided
            if item_update.id:
                db_item = session.get(StockTakeItem, item_update.id)
                if db_item and db_item.stock_take_id == st_id:
                     if item_update.actual_quantity is not None:
                         db_item.actual_quantity = item_update.actual_quantity
                     if item_update.note is not None:
                         db_item.note = item_update.note
                     if item_update.images is not None:
                         db_item.images = item_update.images
                     session.add(db_item)
            elif item_update.product_id:
                 # Find by product_id
                 statement = select(StockTakeItem).where(
                     StockTakeItem.stock_take_id == st_id,
                     StockTakeItem.product_id == item_update.product_id
                 )
                 db_item = session.exec(statement).first()
                 if db_item:
                     if item_update.actual_quantity is not None:
                         db_item.actual_quantity = item_update.actual_quantity
                     if item_update.note is not None:
                         db_item.note = item_update.note
                     if item_update.images is not None:
                         db_item.images = item_update.images
                     session.add(db_item)

    session.add(db_st)
    session.commit()
    session.refresh(db_st)
    return db_st

@app.post("/stock_takes/{st_id}/complete", response_model=StockTakeRead)
def complete_stock_take(st_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_stock_takes"]))):
    db_st = session.get(StockTake, st_id)
    if not db_st:
        raise HTTPException(status_code=404, detail="Stock Take not found")
    
    if db_st.status == "completed":
         raise HTTPException(status_code=400, detail="Already completed")

    # 盤點以商品名稱為單位（前端把同名 SKU 合併成一列），差異與原因也按名稱彙整。
    # 有差異的商品必須填原因（備註），否則不允許完成；完成時彙整成一則通知發給所有 admin。
    groups: dict[str, dict] = {}
    for item in db_st.items:
        if item.system_quantity == 0:
            continue
        name = item.product.name if item.product else f"商品 #{item.product_id}"
        g = groups.setdefault(name, {"system": 0, "actual": 0, "notes": [], "has_image": False})
        g["system"] += item.system_quantity
        g["actual"] += item.actual_quantity if item.actual_quantity is not None else item.system_quantity
        if item.note and item.note.strip():
            g["notes"].append(item.note.strip())
        if item.images:
            g["has_image"] = True

    discrepancies = [(name, g) for name, g in sorted(groups.items()) if g["actual"] != g["system"]]
    missing_reason = [name for name, g in discrepancies if not g["notes"]]
    missing_image = [name for name, g in sorted(groups.items()) if not g["has_image"]]
    problems = []
    if missing_image:
        problems.append(f"以下商品尚未上傳盤點照片：{'、'.join(missing_image)}")
    if missing_reason:
        problems.append(f"以下商品盤點數量有差異，請先填寫原因：{'、'.join(missing_reason)}")
    if problems:
        raise HTTPException(status_code=400, detail="；".join(problems))

    # Apply changes
    for item in db_st.items:
        if item.actual_quantity is not None:
            diff = item.actual_quantity - item.system_quantity
            if diff != 0:
                product = session.get(Product, item.product_id)
                if product:
                    product.stock_quantity += diff
                    session.add(product)
                    
                    # Log
                    log = InventoryLog(
                        product_id=product.id,
                        change_amount=diff,
                        change_type="stock_take",
                        reference_id=f"ST-{db_st.id}"
                    )
                    session.add(log)
    
    db_st.status = "completed"
    db_st.completed_by_name = current_user.full_name or current_user.username
    session.add(db_st)

    if discrepancies:
        lines = []
        for name, g in discrepancies:
            diff = g["actual"] - g["system"]
            kind = "盤盈" if diff > 0 else "盤虧"
            lines.append(f"【{kind}】{name}：系統 {g['system']} → 實際 {g['actual']}（{diff:+d}），原因：{'；'.join(g['notes'])}")
        notify_admins(
            session,
            title=f"盤點差異通知：{db_st.title}（#{db_st.id}）",
            content=(
                f"盤點人：{db_st.taker_name or '-'}，完成人：{db_st.completed_by_name}\n"
                f"共 {len(discrepancies)} 項商品數量有差異：\n" + "\n".join(lines)
            ),
            notification_type="stock_take",
            link="/stock-take",
        )
    session.commit()
    session.refresh(db_st)
    return db_st

@app.delete("/stock_takes/{st_id}")
def delete_stock_take(st_id: int, session: Session = Depends(get_session), current_user: User = Depends(require_permissions(["edit_stock_takes"]))):
    db_st = session.get(StockTake, st_id)
    if not db_st:
        raise HTTPException(status_code=404, detail="Stock Take not found")
        
    for item in db_st.items:
        session.delete(item)
    session.delete(db_st)
    session.commit()
    return {"ok": True}

# User API
@app.get("/users/me", response_model=UserRead)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


# Fields a user may change about themselves via PATCH /users/me. Deliberately
# excludes permissions/is_superuser/is_active/department/employee_id — those
# are account-administration fields and must only change via the
# manage_system-gated /users/{user_id} endpoint, otherwise any logged-in
# account (including a brand-new, zero-permission one) could grant itself
# whatever access it wants through its own profile-edit form.
SELF_EDITABLE_USER_FIELDS = {"email", "full_name", "force_password_change"}

@app.patch("/users/me", response_model=UserRead)
def update_user_me(user_update: UserUpdate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    user_data = user_update.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        if key not in SELF_EDITABLE_USER_FIELDS:
            continue
        setattr(current_user, key, value)

    if user_update.password:
        # Require proof of the current password before changing it — otherwise
        # anyone who gets hold of an already-open session (shared device,
        # unlocked screen, stolen token before it expires) could silently lock
        # the real owner out by setting a new password with nothing but the
        # session they shouldn't have.
        if not user_update.current_password or not verify_password(user_update.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="目前密碼不正確 (Current password is incorrect)")
        current_user.hashed_password = get_password_hash(user_update.password)
        current_user.password_changed_at = datetime.utcnow()

    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@app.post("/users/", response_model=UserRead)
def create_user(
    user_create: UserCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    # Check if username exists
    existing_user = session.exec(select(User).where(User.username == user_create.username)).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Hash password
    hashed_password = get_password_hash(user_create.password)
    
    # 有效權限 = 部門預設權限 ∪ 額外權限；只給 permissions 的舊呼叫端，扣掉部門權限後當成額外權限
    extras = user_create.extra_permissions
    if not extras and user_create.permissions:
        extras = extras_from_legacy_permissions(session, user_create.department, user_create.permissions)

    db_user = User.model_validate(
        user_create,
        update={
            "hashed_password": hashed_password,
            "extra_permissions": extras or [],
            # Never trust the request body for this: superuser accounts can only
            # come from the startup bootstrap admin or a direct DB change, never
            # from a payload passed through this endpoint (see security audit #2).
            "is_superuser": False,
            # Every account an admin creates must change its password on first
            # login — same reasoning as the bootstrap admin account (audit
            # #9): whoever set this password (the admin) isn't the person who
            # will actually use the account, so it can't stay valid long-term.
            "force_password_change": True,
        }
    )
    apply_user_permissions(session, db_user)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

@app.get("/users/", response_model=List[UserRead])
def read_users(
    offset: int = 0,
    limit: int = 100,
    q: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    query = select(User)
    if q:
        query = query.where(
            (User.username.contains(q)) |
            (User.full_name.contains(q)) |
            (User.department.contains(q))
        )
    users = session.exec(query.offset(offset).limit(limit)).all()
    return users

@app.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    user_update: UserUpdate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = user_update.model_dump(exclude_unset=True)
    # permissions 是算出來的，不直接寫；只給 permissions 的舊呼叫端視同設定額外權限
    legacy_permissions = user_data.pop("permissions", None)
    for key, value in user_data.items():
        if key == "password":
            continue # Handle password separately
        setattr(user, key, value)
    if legacy_permissions is not None and "extra_permissions" not in user_data:
        user.extra_permissions = extras_from_legacy_permissions(session, user.department, legacy_permissions)
    apply_user_permissions(session, user)

    # Handle password hashing separately if provided
    if user_update.password:
        user.hashed_password = get_password_hash(user_update.password)
        user.password_changed_at = datetime.utcnow()

    session.add(user)
    session.commit()
    session.refresh(user)
    # 權限、部門、啟用狀態可能變了：LINE 圖文選單跟著換（打 LINE API 放背景，不拖慢回應）
    background_tasks.add_task(sync_users_in_background, session.get_bind(), [user.id])
    return user

@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    binding = session.get(UserLineBinding, user_id)
    line_user_id = binding.line_user_id if binding else None
    if binding:
        session.delete(binding)
    session.delete(user)
    session.commit()
    if line_user_id:
        unlink_rich_menu(line_user_id)  # 帳號刪了，LINE 改回「尚未綁定」選單
    return {"ok": True}

# Department API
@app.post("/departments/", response_model=Department)
def create_department(
    department: Department,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    department.default_permissions = normalize_permissions(department.default_permissions)
    try:
        session.add(department)
        session.commit()
        session.refresh(department)
        return department
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Department with this name already exists")

@app.get("/departments/", response_model=List[Department])
def read_departments(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    return session.exec(select(Department)).all()

@app.patch("/departments/{dept_id}", response_model=Department)
def update_department(
    dept_id: int,
    department_update: Department,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    dept = session.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    old_name = dept.name
    dept_data = department_update.model_dump(exclude_unset=True)
    dept_data.pop("id", None)
    for key, value in dept_data.items():
        setattr(dept, key, value)
    dept.default_permissions = normalize_permissions(dept.default_permissions)

    try:
        session.add(dept)
        session.flush()
        # 部門權限或名稱改了，底下成員的有效權限跟著重算（User.department 存的是名稱，改名要一起改）
        member_ids = []
        for member in session.exec(select(User).where(User.department == old_name)).all():
            member.department = dept.name
            apply_user_permissions(session, member)
            session.add(member)
            member_ids.append(member.id)
        session.commit()
        session.refresh(dept)
        background_tasks.add_task(sync_users_in_background, session.get_bind(), member_ids)
        return dept
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Department name already exists")

@app.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    dept = session.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    # Check if any users are in this department
    # Since User.department is a string, we check by name
    users = session.exec(select(User).where(User.department == dept.name)).first()
    if users:
         raise HTTPException(status_code=400, detail="Cannot delete department with assigned users")

    session.delete(dept)
    session.commit()
    return {"ok": True}

# System Settings API
@app.get("/system-settings/", response_model=List[SystemSetting])
def read_system_settings(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    settings = session.exec(select(SystemSetting)).all()
    return settings

@app.post("/system-settings/", response_model=SystemSetting)
def update_system_setting(
    setting: SystemSetting,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["manage_system"])),
):
    db_setting = session.get(SystemSetting, setting.key)
    if db_setting:
        db_setting.value = setting.value
        db_setting.description = setting.description
        session.add(db_setting)
    else:
        session.add(setting)
    session.commit()
    session.refresh(db_setting if db_setting else setting)
    return db_setting if db_setting else setting

# Transaction API
@app.post("/transactions/", response_model=TransactionRead)
def create_transaction(
    transaction: TransactionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["create_finance"])),
):
    db_transaction = Transaction.model_validate(transaction)
    # 手動記帳的建立者與經手者都是登入者本人，client 傳入的值會被忽略
    db_transaction.created_by = current_user.full_name or current_user.username
    db_transaction.handled_by = db_transaction.created_by
    session.add(db_transaction)
    session.commit()
    session.refresh(db_transaction)
    return db_transaction

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def _month_range(month: str) -> tuple[datetime, datetime]:
    """'YYYY-MM' → [該月 1 日 00:00, 下月 1 日 00:00)，以伺服器時間計。"""
    year, mon = int(month[:4]), int(month[5:7])
    start = datetime(year, mon, 1)
    end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return start, end


@app.get("/transactions/", response_model=List[TransactionRead])
def read_transactions(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    month: Optional[str] = Query(default=None, pattern=MONTH_PATTERN),
    type: Optional[str] = None,
    category: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_finance"])),
):
    query = select(Transaction)
    if month:
        month_start, month_end = _month_range(month)
        query = query.where(Transaction.date >= month_start, Transaction.date < month_end)
    if start_date:
        query = query.where(Transaction.date >= start_date)
    if end_date:
        query = query.where(Transaction.date <= end_date)
    if type:
        query = query.where(Transaction.type == type)
    if category:
        query = query.where(Transaction.category == category)
    
    # Order by date desc
    query = query.order_by(Transaction.date.desc())
    
    return session.exec(query).all()

@app.get("/transactions/monthly", response_model=List[TransactionMonthlySummary])
def read_transactions_monthly(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["view_finance"])),
):
    """每個有記帳的月份一列，新到舊，含當月損益（net）與累計損益（cumulative_net）。在 Python 端分組，SQLite 與 Postgres 行為一致。"""
    summaries: dict[str, TransactionMonthlySummary] = {}
    rows = session.exec(select(Transaction.date, Transaction.type, Transaction.category, Transaction.amount)).all()
    for date, tx_type, category, amount in rows:
        month = date.strftime("%Y-%m")
        summary = summaries.setdefault(month, TransactionMonthlySummary(month=month))
        amount = amount or 0.0
        summary.count += 1
        if tx_type == "income":
            summary.income += amount
            if category == "Sales":
                summary.sales += amount
            else:
                summary.other_income += amount
        elif tx_type == "expense":
            summary.expense += amount
            if category == "Purchase":
                summary.purchase += amount
            elif category == "Refund":
                summary.refund += amount
            else:
                summary.other_expense += amount
    running = 0.0
    for month in sorted(summaries):
        summary = summaries[month]
        summary.net = summary.income - summary.expense
        running += summary.net
        summary.cumulative_net = running
    return sorted(summaries.values(), key=lambda s: s.month, reverse=True)

@app.patch("/transactions/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    transaction_id: int,
    transaction_update: TransactionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["edit_finance"])),
):
    db_transaction = session.get(Transaction, transaction_id)
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    transaction_data = transaction_update.model_dump(exclude_unset=True)
    for key, value in transaction_data.items():
        setattr(db_transaction, key, value)
    
    session.add(db_transaction)
    session.commit()
    session.refresh(db_transaction)
    return db_transaction

@app.websocket("/api/v1/ws/mail-symbols/{member_id}")
async def websocket_endpoint(websocket: WebSocket, member_id: int):
    await manager.connect(websocket, member_id)
    try:
        while True:
            # We don't really expect clients to send much, but keep the connection open
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, member_id)

@app.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_permissions(["edit_finance"])),
):
    db_transaction = session.get(Transaction, transaction_id)
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    session.delete(db_transaction)
    session.commit()
    return {"ok": True}

# --- Serve the built frontend (frontend/dist, copied to ./frontend_dist by the Docker
# build) for the merged single-container deployment. Registered LAST so every API route
# above still wins; a request only falls through to this catch-all when nothing above
# matched. In local dev (no frontend_dist directory — the frontend runs separately via
# `npm run dev` on :5173) this block is skipped entirely and behavior is unchanged.
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "..", "frontend_dist")

if os.path.isdir(FRONTEND_DIST_DIR):
    frontend_assets_dir = os.path.join(FRONTEND_DIST_DIR, "assets")
    if os.path.isdir(frontend_assets_dir):
        app.mount("/assets", StaticFiles(directory=frontend_assets_dir), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        candidate_path = os.path.join(FRONTEND_DIST_DIR, full_path)
        if full_path and full_path != "index.html" and os.path.isfile(candidate_path):
            return FileResponse(candidate_path)
        # Any other path (SPA client-side routes, or a page refresh on one of them)
        # falls back to index.html; react-router takes it from there.
        # no-cache：index.html 沒設快取標頭時瀏覽器會自行快取，部署後仍載入舊的
        # assets/index-*.js（檔名帶 hash，本身可以放心快取）。
        return FileResponse(
            os.path.join(FRONTEND_DIST_DIR, "index.html"),
            headers={"Cache-Control": "no-cache"},
        )
