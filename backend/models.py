from typing import Optional, List, Dict
from datetime import datetime
from sqlmodel import Field, SQLModel, Relationship, JSON

class SystemSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    description: Optional[str] = None

class Department(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    default_permissions: List[str] = Field(default=[], sa_type=JSON)

# User
class UserBase(SQLModel):
    username: str = Field(index=True, unique=True)
    employee_id: Optional[str] = Field(default=None, index=True)
    email: Optional[str] = None
    full_name: Optional[str] = None
    department: Optional[str] = None
    # 有效權限（部門預設權限 ∪ extra_permissions），由 backend/user_permissions.py 重算；權限檢查只看這欄
    permissions: Optional[List[str]] = Field(default=[], sa_type=JSON)
    # 部門之外單獨加給這個帳號的權限
    extra_permissions: Optional[List[str]] = Field(default=[], sa_type=JSON)
    force_password_change: bool = Field(default=False)
    is_active: bool = True
    is_superuser: bool = False
    settings: Optional[Dict] = Field(default={}, sa_type=JSON)

class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    hashed_password: str
    # Not exposed on UserCreate/UserUpdate/UserRead on purpose: only server-side
    # code may set this (on password change), so a JWT issued before the most
    # recent password change can be rejected even though it hasn't expired yet.
    password_changed_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

class UserCreate(UserBase):
    password: str

class UserUpdate(SQLModel):
    email: Optional[str] = None
    employee_id: Optional[str] = None
    full_name: Optional[str] = None
    department: Optional[str] = None
    permissions: Optional[List[str]] = None
    extra_permissions: Optional[List[str]] = None
    force_password_change: Optional[bool] = None
    password: Optional[str] = None
    settings: Optional[Dict] = None
    # Only checked by the self-service path (PATCH /users/me) when password is
    # being changed — proves the caller still knows the account's current
    # password rather than relying solely on an already-open session/token.
    # Not a real column; never persisted.
    current_password: Optional[str] = None

class UserRead(UserBase):
    id: int

# LINE binding (separate table, not User.settings — PATCH /users/me already lets a
# user overwrite their own `settings` dict wholesale, which would let them forge
# line_user_id. Keeping the binding in its own table with its own router closes that gap.)
class UserLineBinding(SQLModel, table=True):
    user_id: int = Field(primary_key=True, foreign_key="user.id")
    line_user_id: str = Field(index=True, unique=True)
    line_display_name: Optional[str] = None
    line_bound_at: datetime = Field(default_factory=datetime.utcnow)

class LineOAuthState(SQLModel, table=True):
    state: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)

class LineRichMenu(SQLModel, table=True):
    """已上傳到 LINE 的圖文選單：同一組磚塊（= 同樣看得到的功能分組）共用一個，見 backend/line_richmenu.py。"""
    signature: str = Field(primary_key=True)
    rich_menu_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Attribute Management for Products
class AttributeBase(SQLModel):
    name: str = Field(index=True, unique=True) # e.g. 材質, 顏色
    description: Optional[str] = None

class Attribute(AttributeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    options: List["AttributeOption"] = Relationship(back_populates="attribute", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

class AttributeOptionBase(SQLModel):
    attribute_id: int = Field(foreign_key="attribute.id")
    value: str

class AttributeOption(AttributeOptionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    attribute: Attribute = Relationship(back_populates="options")
    product_links: List["ProductAttributeLink"] = Relationship(back_populates="option", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

class ProductAttributeLink(SQLModel, table=True):
    product_id: int = Field(foreign_key="product.id", primary_key=True)
    option_id: int = Field(foreign_key="attributeoption.id", primary_key=True)
    
    product: "Product" = Relationship(back_populates="attribute_links")
    option: AttributeOption = Relationship(back_populates="product_links")

class AttributeOptionRead(AttributeOptionBase):
    id: int

class AttributeRead(AttributeBase):
    id: int
    options: List[AttributeOptionRead] = []

class AttributeCreate(AttributeBase):
    pass

class AttributeOptionCreate(AttributeOptionBase):
    pass

# Product
class ProductBase(SQLModel):
    sku: str = Field(index=True, unique=True)
    name: str
    category_name: Optional[str] = None
    style: Optional[str] = None # 款式
    attributes: Optional[Dict] = Field(default=None, sa_type=JSON) # 規格屬性
    image_url: Optional[str] = None # 圖片
    promotion_image_urls: Optional[List[str]] = Field(default=None, sa_type=JSON) # 會員推廣多圖
    promotion_copy: Optional[str] = None # 會員推廣文案
    purchase_url: Optional[str] = None # 會員前台購買連結
    source_url: Optional[str] = None # 採購連結
    barcode: Optional[str] = None
    unit: str = "piece"
    
    # Cost & Price fields
    exchange_rate: Optional[float] = 5.0 # CNY匯率
    price_rmb: Optional[float] = 0.0 # 訂貨單價(CNY)
    shipping_rmb: Optional[float] = 0.0 # 境內運費(CNY)
    shipping_rate_twd: Optional[float] = 0.0 # 1公斤集運費(NTD)
    weight_kg: Optional[float] = 0.0 # 每件重量(Kg)
    batch_quantity: int = 1 # 訂購數量
    
    cost_price: float = 0.0 # 單品成本 (NTD)
    sales_price: float = 0.0 # 預計售價 (NTD)
    min_price: Optional[float] = 0.0 # 最低價
    max_price: Optional[float] = 0.0 # 最高價
    
    pricing_strategy: Optional[str] = None # 定價策略
    is_confirmed: bool = False # 訂購確認

    stock_quantity: int = 0
    safety_stock: int = 0
    lead_time_days: int = 7
    first_received_at: Optional[datetime] = None # 第一次驗收入庫的時間；建立/採購中但尚未驗收時為 None

class Product(ProductBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    inventory_logs: List["InventoryLog"] = Relationship(back_populates="product")
    po_items: List["POItem"] = Relationship(back_populates="product")
    so_items: List["SOItem"] = Relationship(back_populates="product")
    return_items: List["ReturnItem"] = Relationship(back_populates="product")
    stock_take_items: List["StockTakeItem"] = Relationship(back_populates="product")
    attribute_links: List["ProductAttributeLink"] = Relationship(back_populates="product", sa_relationship_kwargs={"cascade": "all, delete-orphan"})

class ProductCreate(ProductBase):
    attribute_option_ids: Optional[List[int]] = None

class ProductRead(ProductBase):
    id: int
    # We will include resolved attributes
    # The actual structure can be {"材質": "純棉", "顏色": "紅色"}
    # Or a list of AttributeOptionRead
    attribute_options: List[AttributeOptionRead] = []

# Purchase Order
class PurchaseOrderBase(SQLModel):
    supplier_name: str
    order_date: datetime = Field(default_factory=datetime.now)
    status: str = "draft" # draft, approved, received, completed
    total_amount: float = 0.0
    total_weight: float = 0.0
    total_shipping_fee: float = 0.0
    total_cost: float = 0.0
    tariff: float = 0.0
    purchaser_name: Optional[str] = None # New Field
    # 報廢：None / "pending"（已申請報廢，等簽呈核准，期間凍結）/ "voided"。一律由後端寫入；
    # 單據不能刪除，報廢的單永遠留在頁面上（見 backend/voiding.py）
    void_status: Optional[str] = None
    void_reason: Optional[str] = None
    void_requested_by: Optional[str] = None
    voided_by: Optional[str] = None
    voided_at: Optional[datetime] = None

class PurchaseOrder(PurchaseOrderBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    purchaser_name: str = Field(default="System", nullable=False) # Enforce NOT NULL in DB
    items: List["POItem"] = Relationship(back_populates="order")

class POItemBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    quantity: int
    unit_price: float
    received_quantity: Optional[int] = Field(default=None, description="Actual received quantity")
    note: Optional[str] = None
    shortage_reason: Optional[str] = None # 實際驗收少於採購數量時必填，入庫時通知 admin
    receiving_image: Optional[str] = None
    receiving_video: Optional[str] = None
    # 各商品的供應商（同一張採購單可以有多家）；NULL 表示沿用採購單的 supplier_name（舊資料、LIFF 建的單）
    supplier_name: Optional[str] = None
    
class POItem(POItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="purchaseorder.id")
    order: PurchaseOrder = Relationship(back_populates="items")
    product: Product = Relationship(back_populates="po_items")

# Sales Order
class SalesOrderBase(SQLModel):
    order_number: Optional[str] = Field(default=None, index=True, unique=True) # Randomly generated
    customer_id: str
    member_id: Optional[int] = Field(default=None, foreign_key="member.id")
    platform: str = "manual" # e.g. shopee, amazon, manual
    order_date: datetime = Field(default_factory=datetime.now)
    status: str = "pending" # pending, shipped, completed
    total_amount: float = 0.0
    total_quantity: int = 0
    # 出貨人（full_name 或 username），一律由後端依登入者填寫，同 PurchaseOrder.purchaser_name；client 傳入的值會被忽略。
    shipped_by: Optional[str] = None
    shipping_date: Optional[datetime] = None
    estimated_arrival: Optional[datetime] = None
    # 報廢：None / "pending"（已申請報廢，等簽呈核准，期間凍結）/ "voided"。一律由後端寫入；
    # 單據不能刪除，報廢的單永遠留在頁面上（見 backend/voiding.py）
    void_status: Optional[str] = None
    void_reason: Optional[str] = None
    void_requested_by: Optional[str] = None
    voided_by: Optional[str] = None
    voided_at: Optional[datetime] = None
    earned_points: int = Field(default=0) # New field for bonus points
    # 蝦皮出貨單 QRcode 圖片（/uploadfile/ 回傳的 URL），整張出貨單一張
    shopee_qrcode_image: Optional[str] = None

class SalesOrder(SalesOrderBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    # 依 id 排序：撿貨分頁顯示與更新通知的逐項比對都靠固定順序
    items: List["SOItem"] = Relationship(back_populates="order", sa_relationship_kwargs={"order_by": "SOItem.id"})
    member: Optional["Member"] = Relationship(back_populates="orders")

class SOItemBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    quantity: int
    unit_price: float
    shipping_image: Optional[str] = None
    shipping_video: Optional[str] = None
    # 單項商品的撿貨狀態：picking（撿貨中）/ picked（已撿貨），只能由撿貨分頁的專用 API 修改；SOItemCreate 刻意不含此欄
    picking_status: str = Field(default="picking")

class SOItem(SOItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="salesorder.id")
    order: SalesOrder = Relationship(back_populates="items")
    product: Product = Relationship(back_populates="so_items")

# Supplier
class SupplierBase(SQLModel):
    name: str = Field(index=True, unique=True)
    category: Optional[str] = None # 1688賣家, 淘寶賣家
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    bank_account: Optional[str] = None
    note: Optional[str] = None
    note_updated_at: Optional[datetime] = None

class Supplier(SupplierBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    # 評分 0~5 星（0.5 為單位），新供應商滿分；驗收短收時自動扣分，等級由評分推導
    rating: float = Field(default=5.0)
    shortage_count: int = Field(default=0) # 累計短收（採購單）次數
    last_shortage_at: Optional[datetime] = None
    last_shortage_note: Optional[str] = None # 最近一次短收摘要，建立採購單時提示用

class SupplierRead(SupplierBase):
    id: int
    rating: float = 5.0
    shortage_count: int = 0
    last_shortage_at: Optional[datetime] = None
    last_shortage_note: Optional[str] = None
    grade: str = "A" # A 優良 / B 普通 / C 注意 / D 高風險，由 rating 推導

# 供應商評分異動紀錄（驗收短收自動扣分、手動調整）
class SupplierRatingLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    supplier_id: int = Field(foreign_key="supplier.id", index=True)
    po_id: Optional[int] = None
    event_type: str # receiving_shortage, manual_adjust
    rating_before: float
    rating_after: float
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    created_by_name: Optional[str] = None

class SupplierUpdate(SQLModel):
    name: Optional[str] = None
    category: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    bank_account: Optional[str] = None
    note: Optional[str] = None
    note_updated_at: Optional[datetime] = None
    rating: Optional[float] = Field(default=None, ge=0, le=5) # 手動調整評分，會寫入 SupplierRatingLog
    rating_reason: Optional[str] = None # 手動調整原因（不存 Supplier，寫進評分紀錄）

# Category
class CategoryBase(SQLModel):
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None

class Category(CategoryBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

# Inventory Log
class InventoryLogBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    change_amount: int
    change_type: str # purchase, sale, adjustment
    log_date: datetime = Field(default_factory=datetime.now)
    reference_id: Optional[str] = None # PO-1, SO-1

class InventoryLog(InventoryLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    product: Product = Relationship(back_populates="inventory_logs")

# DTOs for creation with nested items
class POItemCreate(SQLModel):
    product_id: int
    quantity: int
    unit_price: float
    supplier_name: Optional[str] = None # 沒帶時：建立用採購單的供應商；更新時保留原本的值（驗收頁不會送這欄）
    received_quantity: Optional[int] = None
    note: Optional[str] = None
    shortage_reason: Optional[str] = None
    create_supplementary: bool = False # 驗收短收時勾選：入庫同時建立補驗收單（不存 DB）
    receiving_image: Optional[str] = None
    receiving_video: Optional[str] = None

# Member System
class MemberBase(SQLModel):
    name: str = Field(index=True)
    gender: Optional[str] = None # 'Male', 'Female', 'Other'
    birthday: Optional[datetime] = None
    phone: str = Field(index=True, unique=True) # Encrypted in logic if needed, but unique constraint implies plain text or deterministic encryption
    line_id: Optional[str] = None
    email: Optional[str] = Field(default=None, index=True, unique=True)
    email_status: str = Field(default="active", description="active, bounced, unsubscribed")
    address: Optional[str] = None # Primary address
    is_subscribed: bool = Field(default=True) # Agree to receive info
    
    level: str = Field(default="Bronze") # Bronze, Silver, Gold, Platinum
    points: int = Field(default=0)
    total_spent: float = Field(default=0.0)
    
    referral_code: Optional[str] = Field(default=None, index=True, unique=True)
    referred_by: Optional[str] = None # Referral code of the introducer
    
    social_provider: Optional[str] = None # 'google', 'line', 'facebook'
    social_id: Optional[str] = None
    
    is_active: bool = Field(default=True)
    note: Optional[str] = None

class Member(MemberBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    password_hash: Optional[str] = None # Optional for social login users
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    # Not exposed on MemberCreate/MemberUpdate/MemberRead: same purpose as
    # User.password_changed_at (JWT-issued-before-password-change rejection).
    password_changed_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    last_purchase_date: Optional[datetime] = None
    
    addresses: List["MemberAddress"] = Relationship(back_populates="member")
    orders: List["SalesOrder"] = Relationship(back_populates="member")

class MemberCreate(MemberBase):
    password: Optional[str] = None

class MemberUpdate(SQLModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    birthday: Optional[datetime] = None
    phone: Optional[str] = None
    line_id: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    is_subscribed: Optional[bool] = None
    password: Optional[str] = None
    level: Optional[str] = None
    points: Optional[int] = None
    is_active: Optional[bool] = None
    note: Optional[str] = None

class MemberRead(MemberBase):
    id: int
    created_at: datetime
    updated_at: datetime
    last_purchase_date: Optional[datetime] = None

# New DM / Promotion System
class PromotionDMBase(SQLModel):
    title: str = Field(index=True)
    image_url: str
    link: Optional[str] = None
    content: Optional[str] = None
    status: str = Field(default="draft") # draft, reviewing, published, unpublished
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    target_levels: List[str] = Field(default=["all"], sa_type=JSON) # e.g. ["Gold", "Platinum"] or ["all"]
    tags: List[str] = Field(default=[], sa_type=JSON)
    views: int = Field(default=0)
    clicks: int = Field(default=0)

class PromotionDM(PromotionDMBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    created_by: Optional[int] = Field(default=None, foreign_key="user.id")
    favorites: List["PromotionFavorite"] = Relationship(back_populates="dm")

class PromotionFavorite(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    member_id: int = Field(foreign_key="member.id")
    dm_id: int = Field(foreign_key="promotiondm.id")
    created_at: datetime = Field(default_factory=datetime.now)
    
    dm: PromotionDM = Relationship(back_populates="favorites")

class PromotionDMCreate(PromotionDMBase):
    pass

class PromotionDMUpdate(SQLModel):
    title: Optional[str] = None
    image_url: Optional[str] = None
    link: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    target_levels: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    views: Optional[int] = None
    clicks: Optional[int] = None

# --- Marketing & Messaging Hub Models ---

class MessageTemplateBase(SQLModel):
    name: str
    subject: str
    content_html: str
    description: Optional[str] = None
    metadata_json: Optional[Dict] = Field(default={}, sa_type=JSON)

class MessageTemplate(MessageTemplateBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

class MessageTemplateCreate(MessageTemplateBase):
    pass

class MessageTemplateUpdate(SQLModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    content_html: Optional[str] = None
    description: Optional[str] = None
    metadata_json: Optional[Dict] = None

class TargetSegmentBase(SQLModel):
    name: str
    description: Optional[str] = None
    filter_rules: Dict = Field(default={}, sa_type=JSON) # e.g., {"level": "VIP", "min_points": 100}

class TargetSegment(TargetSegmentBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

class TargetSegmentCreate(TargetSegmentBase):
    pass

class TargetSegmentUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    filter_rules: Optional[Dict] = None

class CampaignBase(SQLModel):
    name: str
    subject: str
    content_html: str
    channels: List[str] = Field(default=["in_app", "email"], sa_type=JSON)
    segment_id: Optional[int] = Field(foreign_key="targetsegment.id", default=None)
    scheduled_at: Optional[datetime] = None
    status: str = Field(default="draft") # draft, scheduled, processing, completed, failed
    metadata_json: Optional[Dict] = Field(default={}, sa_type=JSON)

class Campaign(CampaignBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)
    sent_count: int = 0
    open_count: int = 0
    click_count: int = 0

class CampaignCreate(CampaignBase):
    pass

class CampaignUpdate(SQLModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    content_html: Optional[str] = None
    channels: Optional[List[str]] = None
    segment_id: Optional[int] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None
    metadata_json: Optional[Dict] = None

class CampaignLogBase(SQLModel):
    campaign_id: int = Field(foreign_key="campaign.id")
    member_id: int = Field(foreign_key="member.id")
    channel: str
    status: str = Field(default="pending") # pending, sent, failed, opened, clicked
    error_msg: Optional[str] = None

class CampaignLog(CampaignLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sent_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    clicked_at: Optional[datetime] = None

class AutomatedTriggerBase(SQLModel):
    name: str
    event_type: str # 'birthday', 'register', 'points_expire'
    template_id: int = Field(foreign_key="messagetemplate.id")
    is_active: bool = Field(default=True)
    condition_rules: Dict = Field(default={}, sa_type=JSON)

class AutomatedTrigger(AutomatedTriggerBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

class AutomatedTriggerCreate(AutomatedTriggerBase):
    pass

class AutomatedTriggerUpdate(SQLModel):
    name: Optional[str] = None
    event_type: Optional[str] = None
    template_id: Optional[int] = None
    is_active: Optional[bool] = None
    condition_rules: Optional[Dict] = None
class PointExchangeEventBase(SQLModel):
    title: str
    required_points: int
    discount_code_template: Optional[str] = None # E.g., 'DISC-90', or empty for auto-generated
    discount_rate: float = Field(default=1.0, description="Multiplier, e.g. 0.9 for 10% off")
    valid_days: int = Field(default=30)
    min_spend: float = Field(default=0.0)
    description: Optional[str] = None
    is_active: bool = Field(default=True)

class PointExchangeEvent(PointExchangeEventBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

class PointExchangeRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    member_id: int = Field(foreign_key="member.id")
    event_id: int = Field(foreign_key="pointexchangeevent.id")
    points_used: int
    status: str = Field(default="active") # active, used, expired
    valid_until: datetime
    created_at: datetime = Field(default_factory=datetime.now)

class PointExchangeEventCreate(PointExchangeEventBase):
    pass

class PointExchangeEventRead(PointExchangeEventBase):
    id: int
    created_at: datetime

class PointExchangeRecordRead(SQLModel):
    id: int
    event_id: int
    event_title: str
    points_used: int
    status: str
    valid_until: datetime
    created_at: datetime

# Transaction Log for Points
class PointTransactionLogBase(SQLModel):
    member_id: int = Field(foreign_key="member.id")
    operator_id: Optional[int] = Field(default=None, description="System User ID who operated")
    before_balance: int
    change_amount: int
    after_balance: int
    reason: str
    transaction_type: str = Field(default="system_add")

class PointTransactionLog(PointTransactionLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

class MemberAddress(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    member_id: int = Field(foreign_key="member.id")
    recipient_name: str
    recipient_phone: str
    address: str
    is_default: bool = False
    
    member: Member = Relationship(back_populates="addresses")

import uuid

class MailSymbolBase(SQLModel):
    member_id: int = Field(foreign_key="member.id")
    symbol_type: str = Field(description="promo, system, other")
    title: str = Field(max_length=100)
    content: str = Field(max_length=2000)
    metadata_json: Optional[Dict] = Field(default=None, sa_type=JSON)
    is_read: bool = Field(default=False)
    read_at: Optional[datetime] = None

class MailSymbol(MailSymbolBase, table=True):
    __tablename__ = "mail_symbols"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

class MailSymbolCreate(SQLModel):
    symbolType: str
    title: str
    content: str
    symbol_metadata: Optional[Dict] = Field(default=None, alias="metadata")

class MailSymbolRead(SQLModel):
    id: uuid.UUID
    memberId: int
    symbolType: str
    title: str
    content: str
    symbol_metadata: Optional[Dict] = Field(default=None, alias="metadata")
    isRead: bool
    readAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

class PurchaseOrderCreate(PurchaseOrderBase):
    items: List[POItemCreate]

class ProductUpdate(SQLModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category_name: Optional[str] = None
    style: Optional[str] = None
    attributes: Optional[Dict] = None
    image_url: Optional[str] = None
    promotion_image_urls: Optional[List[str]] = None
    promotion_copy: Optional[str] = None
    purchase_url: Optional[str] = None
    source_url: Optional[str] = None
    barcode: Optional[str] = None
    unit: Optional[str] = None
    
    exchange_rate: Optional[float] = None
    price_rmb: Optional[float] = None
    shipping_rmb: Optional[float] = None
    shipping_rate_twd: Optional[float] = None
    weight_kg: Optional[float] = None
    batch_quantity: Optional[int] = None
    
    cost_price: Optional[float] = None
    sales_price: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    
    pricing_strategy: Optional[str] = None
    is_confirmed: Optional[bool] = None

    stock_quantity: Optional[int] = None
    safety_stock: Optional[int] = None
    lead_time_days: Optional[int] = None
    attribute_option_ids: Optional[List[int]] = None

class PurchaseOrderUpdate(SQLModel):
    status: Optional[str] = None
    supplier_name: Optional[str] = None
    total_amount: Optional[float] = None
    total_weight: Optional[float] = None
    total_shipping_fee: Optional[float] = None
    total_cost: Optional[float] = None
    tariff: Optional[float] = None
    received_by: Optional[str] = None
    items: Optional[List[POItemCreate]] = None

class SOItemCreate(SQLModel):
    product_id: int
    quantity: int
    unit_price: float
    shipping_image: Optional[str] = None
    shipping_video: Optional[str] = None

class SalesOrderCreate(SalesOrderBase):
    items: List[SOItemCreate]

class SalesOrderUpdate(SQLModel):
    status: Optional[str] = None
    customer_id: Optional[str] = None
    platform: Optional[str] = None
    total_amount: Optional[float] = None
    total_quantity: Optional[int] = None
    shipped_by: Optional[str] = None
    shipping_date: Optional[datetime] = None
    shopee_qrcode_image: Optional[str] = None
    items: Optional[List[SOItemCreate]] = None

class SalesOrderRead(SalesOrderBase):
    id: int
    items: List[SOItemBase]

# Return Order
class ReturnOrderBase(SQLModel):
    return_number: Optional[str] = Field(default=None, index=True, unique=True)
    order_id: Optional[int] = Field(default=None, foreign_key="salesorder.id", nullable=True)
    customer_id: Optional[str] = None
    return_date: datetime = Field(default_factory=datetime.now)
    status: str = "pending" # pending, completed
    # return = 退貨退款（有商品，完成時加回庫存）；refund_only = 僅退款（無商品，只記退款支出）
    return_type: str = "return"
    total_refund_amount: float = 0.0
    note: Optional[str] = None
    # 經辦人：由後端依建立者帳號寫入，前端送來的值會被忽略
    handled_by: Optional[str] = None
    # 報廢：None / "pending"（已申請報廢，等簽呈核准，期間凍結）/ "voided"。一律由後端寫入；
    # 退貨單不能刪除，報廢的單永遠留在頁面上（見 backend/voiding.py）
    void_status: Optional[str] = None
    void_reason: Optional[str] = None
    void_requested_by: Optional[str] = None
    voided_by: Optional[str] = None
    voided_at: Optional[datetime] = None

class ReturnOrder(ReturnOrderBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    items: List["ReturnItem"] = Relationship(back_populates="return_order")

class ReturnItemBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    quantity: int
    unit_price: float = 0.0
    reason: Optional[str] = None
    return_image: Optional[str] = None
    return_video: Optional[str] = None

class ReturnItem(ReturnItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    return_order_id: int = Field(foreign_key="returnorder.id")
    return_order: ReturnOrder = Relationship(back_populates="items")
    product: Product = Relationship(back_populates="return_items")

class PurchaseOrderRead(PurchaseOrderBase):
    id: int
    items: List[POItemBase]

class ReturnItemCreate(SQLModel):
    product_id: int
    quantity: int
    unit_price: float
    reason: Optional[str] = None
    return_image: Optional[str] = None
    return_video: Optional[str] = None

class ReturnOrderCreate(ReturnOrderBase):
    items: List[ReturnItemCreate] = []

class ReturnOrderUpdate(SQLModel):
    status: Optional[str] = None
    return_type: Optional[str] = None
    customer_id: Optional[str] = None
    total_refund_amount: Optional[float] = None
    note: Optional[str] = None
    items: Optional[List[ReturnItemCreate]] = None

class ReturnOrderRead(ReturnOrderBase):
    id: int
    items: List[ReturnItemBase]

# Stock Take
class StockTakeBase(SQLModel):
    title: str = Field(default="Stock Take")
    created_at: datetime = Field(default_factory=datetime.now)
    status: str = "draft" # draft, completed
    note: Optional[str] = None
    # 發起盤點／完成盤點的帳號（full_name 或 username），一律由後端依登入者填寫，
    # 同 PurchaseOrder.purchaser_name 的做法；client 傳入的值會被覆蓋。
    taker_name: Optional[str] = None
    completed_by_name: Optional[str] = None

class StockTake(StockTakeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    items: List["StockTakeItem"] = Relationship(back_populates="stock_take")

class StockTakeItemBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    system_quantity: int # Snapshot at creation
    actual_quantity: Optional[int] = None # User input
    note: Optional[str] = None
    images: Optional[List[str]] = Field(default=None, sa_type=JSON) # 盤點商品照片（多張）

class StockTakeItem(StockTakeItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    stock_take_id: int = Field(foreign_key="stocktake.id")
    stock_take: StockTake = Relationship(back_populates="items")
    product: Product = Relationship(back_populates="stock_take_items")

class StockTakeItemUpdate(SQLModel):
    id: Optional[int] = None # Optional for existing items
    product_id: Optional[int] = None # 以 id 或 product_id 擇一定位項目（前端只送 id）
    actual_quantity: Optional[int] = None
    note: Optional[str] = None
    images: Optional[List[str]] = None

class StockTakeCreate(StockTakeBase):
    pass

class StockTakeUpdate(SQLModel):
    status: Optional[str] = None
    note: Optional[str] = None
    items: Optional[List[StockTakeItemUpdate]] = None

class StockTakeItemRead(StockTakeItemBase):
    id: int
    product: Product

class StockTakeRead(StockTakeBase):
    id: int
    items: List[StockTakeItemRead]

# 補驗收單：採購單驗收短收後，從驗收紀錄建立（使用者不能自行新增），
# 只包含還沒補齊的品項與數量。補驗收入庫只加庫存、不再產生支出交易（原採購單入庫時已全額記帳）。
# 以 po_id + product_id 對應原採購品項，不存 POItem.id——update_po 每次 PATCH 都會重建 POItem。
class SupplementaryReceivingBase(SQLModel):
    po_id: int = Field(foreign_key="purchaseorder.id", index=True)
    supplier_name: Optional[str] = None # 建立時從採購單複製
    status: str = "pending" # pending, received
    created_at: datetime = Field(default_factory=datetime.now)
    created_by_name: Optional[str] = None
    received_at: Optional[datetime] = None
    received_by_name: Optional[str] = None

class SupplementaryReceiving(SupplementaryReceivingBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    items: List["SupplementaryReceivingItem"] = Relationship(back_populates="supplementary_receiving")

class SupplementaryReceivingItemBase(SQLModel):
    product_id: int = Field(foreign_key="product.id")
    quantity: int # 待補數量（建立時的剩餘短收數量）
    received_quantity: Optional[int] = None
    note: Optional[str] = None
    shortage_reason: Optional[str] = None # 補驗收仍短收時必填
    receiving_image: Optional[str] = None
    receiving_video: Optional[str] = None

class SupplementaryReceivingItem(SupplementaryReceivingItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    supplementary_receiving_id: int = Field(foreign_key="supplementaryreceiving.id")
    supplementary_receiving: SupplementaryReceiving = Relationship(back_populates="items")
    product: Product = Relationship()

class SupplementaryReceivingCreate(SQLModel):
    po_id: int

class SupplementaryReceivingItemReceive(SQLModel):
    id: int
    received_quantity: int
    note: Optional[str] = None
    shortage_reason: Optional[str] = None
    create_supplementary: bool = False # 仍短收時勾選：入庫同時再建一張補驗收單
    receiving_image: Optional[str] = None
    receiving_video: Optional[str] = None

class SupplementaryReceivingReceive(SQLModel):
    items: List[SupplementaryReceivingItemReceive]

class SupplementaryReceivingItemRead(SupplementaryReceivingItemBase):
    id: int
    product: Product

class SupplementaryReceivingRead(SupplementaryReceivingBase):
    id: int
    items: List[SupplementaryReceivingItemRead]

# 員工後台站內通知（每個 User 各自一筆、各自已讀）。會員端的站內信是 MailSymbol，兩者不共用。
class UserNotificationBase(SQLModel):
    title: str
    content: str
    notification_type: str = "system" # system, stock_take, receiving_shortage, supplementary_receiving
    link: Optional[str] = None # 前端路由，例如 /stock-take
    is_read: bool = False
    created_at: datetime = Field(default_factory=datetime.now)
    read_at: Optional[datetime] = None

class UserNotification(UserNotificationBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

class UserNotificationRead(UserNotificationBase):
    id: int

# Transaction (Accounting)
class TransactionBase(SQLModel):
    date: datetime = Field(default_factory=datetime.now)
    type: str # income, expense
    category: str # e.g. Sales, Purchase, Rent, Salary, Utilities, Other
    amount: float
    description: Optional[str] = None
    payment_method: Optional[str] = "Cash" # Cash, Bank Transfer, Credit Card
    reference_id: Optional[str] = None # Optional link to external ID like SO-123
    # 建立者：來源單據的建立者（出貨單的 shipped_by、退貨單的 handled_by；手動記帳則為登入者）
    # 經手者：實際觸發這筆記帳的登入者（把出貨單推到已出貨、把退貨單改成已完成的人）
    # 兩者一律由後端寫入，client 傳入的值會被忽略
    created_by: Optional[str] = None
    handled_by: Optional[str] = None

class Transaction(TransactionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

class TransactionCreate(TransactionBase):
    pass

class TransactionUpdate(SQLModel):
    date: Optional[datetime] = None
    type: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    payment_method: Optional[str] = None
    reference_id: Optional[str] = None

class TransactionRead(TransactionBase):
    id: int

class TransactionMonthlySummary(SQLModel):
    """記帳單按月彙總（GET /transactions/monthly）。金額都是正數，net = income - expense。"""
    month: str  # YYYY-MM
    income: float = 0.0
    expense: float = 0.0
    net: float = 0.0
    sales: float = 0.0          # 出貨收入（category=Sales）
    purchase: float = 0.0       # 進貨成本（category=Purchase）
    refund: float = 0.0         # 退款（category=Refund）
    other_income: float = 0.0   # 其他收入
    other_expense: float = 0.0  # 其他支出（包材、租金、薪資、物流…）
    count: int = 0
    cumulative_net: float = 0.0 # 累計損益：從第一筆記帳的月份一路加到本月的 net

# System Log
class SystemLogBase(SQLModel):
    timestamp: datetime = Field(default_factory=datetime.now, index=True)
    username: str = Field(index=True)
    action: str = Field(index=True)  # 動作代碼（create, update, delete, login…），顯示時由 backend/audit.py 翻成中文
    resource: str = Field(index=True) # 功能代碼（請求路徑第一段，例如 products）
    details: Optional[str] = None # 中文操作明細：做了什麼、改了哪些資料（見 backend/audit.py）
    status: str = Field(default="success") # success, failure

class SystemLog(SystemLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    # 已停用：系統日誌不再記錄 IP。欄位留著是因為既有資料庫的這欄是 NOT NULL，新紀錄一律寫空字串。
    ip_address: str = Field(default="", index=True)

class SystemLogRead(SystemLogBase):
    id: int

# 簽呈（ChangeRequest）：已鎖定的單據（例如「已完成」的採購單）要修改或刪除時，
# 由申請人送出，經該功能的核准權限（approve_X）核准後，得到只限這張單、有期限與次數的臨時權限。
class ChangeRequestBase(SQLModel):
    resource_type: str = Field(index=True)  # 見 backend/change_requests.py 的 RESOURCES，例如 "purchase_order"
    resource_id: int = Field(index=True)
    action: str  # "edit"（修改已鎖定的單，核准後給臨時權限）| "void"（報廢，核准即執行）；"delete" 只剩舊資料
    reason: str
    attachment_url: Optional[str] = None

class ChangeRequest(ChangeRequestBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    requester_id: int = Field(foreign_key="user.id", index=True)
    requester_name: str
    status: str = Field(default="pending", index=True)  # pending, approved, rejected, cancelled
    created_at: datetime = Field(default_factory=datetime.now)
    approver_id: Optional[int] = Field(default=None, foreign_key="user.id")
    approver_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None
    expires_at: Optional[datetime] = None
    max_uses: int = 0
    used_count: int = 0

class ChangeRequestCreate(ChangeRequestBase):
    pass

class ChangeRequestApprove(SQLModel):
    valid_hours: int = 24  # 核准人決定，最長一天
    max_uses: int = 1
    note: Optional[str] = None

class ChangeRequestReject(SQLModel):
    note: Optional[str] = None

class ChangeRequestRead(ChangeRequestBase):
    id: int
    requester_id: int
    requester_name: str
    status: str
    created_at: datetime
    approver_id: Optional[int] = None
    approver_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None
    expires_at: Optional[datetime] = None
    max_uses: int
    used_count: int
    # 以下由 API 算出，不存 DB
    effective_status: str  # pending, active, used_up, expired, rejected, cancelled
    resource_label: str
    resource_link: Optional[str] = None

# Product Listing Batch (商品上架批次)
class ProductListingBatchBase(SQLModel):
    created_at: datetime = Field(default_factory=datetime.now)
    created_by_id: int = Field(foreign_key="user.id")
    status: str = Field(default="draft")
    published_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None

class ProductListingBatch(ProductListingBatchBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    items: List["ProductListingItem"] = Relationship(back_populates="batch")
    
class ProductListingItemBase(SQLModel):
    batch_id: int = Field(foreign_key="productlistingbatch.id")
    product_id: int = Field(foreign_key="product.id")
    quantity: int

class ProductListingItem(ProductListingItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    batch: ProductListingBatch = Relationship(back_populates="items")
    product: Product = Relationship()

class ProductListingItemRead(ProductListingItemBase):
    id: int
    product_sku: str
    product_name: str
    sales_price: float
    stock_quantity: int
    image_url: Optional[str] = None

class ProductListingBatchRead(ProductListingBatchBase):
    id: int
    created_at: datetime
    created_by_name: str
    items: List[ProductListingItemRead]

class ProductListingCreateItem(SQLModel):
    product_id: int
    quantity: int

class ProductListingCreate(SQLModel):
    items: List[ProductListingCreateItem]


class ProductListingBatchStatusUpdate(SQLModel):
    status: str


class MemberProductCatalogItem(SQLModel):
    product_id: int
    product_name: str
    category_name: str
    image_url: Optional[str] = None
    image_urls: List[str] = []
    sales_price: float
    stock_quantity: int
    stock_status: str
    batch_id: int
    first_published_at: datetime
    last_published_at: datetime
    sales_volume: int = 0
    promotion_copy_excerpt: Optional[str] = None
    promotion_copy: Optional[str] = None
    purchase_url: Optional[str] = None


class MemberProductOverview(SQLModel):
    current_month_label: str
    current_month_total: int
    total_online_products: int
    current_month_items: List[MemberProductCatalogItem]
    all_items: List[MemberProductCatalogItem]
