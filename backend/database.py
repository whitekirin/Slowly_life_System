import os
from sqlalchemy import text, inspect
from sqlmodel import SQLModel, create_engine, Session
from backend.config import settings

# Get absolute path to the directory where database.py is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sqlite_file_name = "database.db"
default_sqlite_url = f"sqlite:///{os.path.join(BASE_DIR, sqlite_file_name)}"

# settings.DATABASE_URL (from DATABASE_URL env var / .env) takes over when set,
# e.g. postgresql+psycopg://user:pass@host:5432/db. Empty string keeps today's
# local SQLite file behavior unchanged.
DATABASE_URL = settings.DATABASE_URL or default_sqlite_url

is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# SQLite-only ALTER TABLE uses "DATETIME"; Postgres needs "TIMESTAMP".
_datetime_column_type = "DATETIME" if is_sqlite else "TIMESTAMP"


def _table_columns(table_name: str):
    """Dialect-agnostic column name lookup (replaces the old SQLite-only
    `PRAGMA table_info(...)` calls, which error out on Postgres). Returns None
    if the table doesn't exist yet (e.g. very first boot before create_all())."""
    inspector = inspect(engine)
    if not inspector.has_table(table_name):
        return None
    return {col["name"] for col in inspector.get_columns(table_name)}


def _ensure_product_listing_schema():
    with Session(engine) as session:
        column_names = _table_columns("productlistingbatch")
        if column_names is None:
            return

        alter_statements = []

        if "status" not in column_names:
            alter_statements.append(
                "ALTER TABLE productlistingbatch ADD COLUMN status VARCHAR DEFAULT 'draft' NOT NULL"
            )
        if "published_at" not in column_names:
            alter_statements.append(
                f"ALTER TABLE productlistingbatch ADD COLUMN published_at {_datetime_column_type}"
            )
        if "archived_at" not in column_names:
            alter_statements.append(
                f"ALTER TABLE productlistingbatch ADD COLUMN archived_at {_datetime_column_type}"
            )

        for statement in alter_statements:
            session.exec(text(statement))

        if alter_statements:
            session.commit()

def _ensure_product_promotion_schema():
    with Session(engine) as session:
        column_names = _table_columns("product")
        if column_names is None:
            return

        alter_statements = []

        if "promotion_image_urls" not in column_names:
            alter_statements.append(
                "ALTER TABLE product ADD COLUMN promotion_image_urls JSON"
            )
        if "category_name" not in column_names:
            alter_statements.append(
                "ALTER TABLE product ADD COLUMN category_name VARCHAR"
            )
        if "promotion_copy" not in column_names:
            alter_statements.append(
                "ALTER TABLE product ADD COLUMN promotion_copy TEXT"
            )
        if "purchase_url" not in column_names:
            alter_statements.append(
                "ALTER TABLE product ADD COLUMN purchase_url VARCHAR"
            )

        for statement in alter_statements:
            session.exec(text(statement))

        if alter_statements:
            session.commit()

def _ensure_password_changed_at_schema():
    """Backfills User.password_changed_at / Member.password_changed_at for rows
    that predate this column. Existing rows get "now" so every JWT already
    issued (which predates this migration) is treated as issued before the
    password was last changed, and gets rejected — forcing a fresh login once
    instead of leaving pre-existing tokens valid forever."""
    with Session(engine) as session:
        alter_statements = []

        user_columns = _table_columns("user")
        if user_columns is not None and "password_changed_at" not in user_columns:
            alter_statements.append(f'ALTER TABLE "user" ADD COLUMN password_changed_at {_datetime_column_type}')
            alter_statements.append('UPDATE "user" SET password_changed_at = CURRENT_TIMESTAMP WHERE password_changed_at IS NULL')

        member_columns = _table_columns("member")
        if member_columns is not None and "password_changed_at" not in member_columns:
            alter_statements.append(f'ALTER TABLE "member" ADD COLUMN password_changed_at {_datetime_column_type}')
            alter_statements.append('UPDATE "member" SET password_changed_at = CURRENT_TIMESTAMP WHERE password_changed_at IS NULL')

        for statement in alter_statements:
            session.exec(text(statement))

        if alter_statements:
            session.commit()

def _ensure_product_first_received_schema():
    """Backfills Product.first_received_at for rows that predate this column.

    A product created via a purchase order used to show up in 商品管理中心
    immediately on save, even as a draft with zero stock — before anyone
    actually received it. This column tracks the first real 驗收 (receiving)
    event so those views can hide products until that happens. Existing rows
    get backfilled from InventoryLog history (change_type='purchase') so
    products already received before this migration don't disappear."""
    with Session(engine) as session:
        column_names = _table_columns("product")
        if column_names is None:
            return
        if "first_received_at" in column_names:
            return

        session.exec(text(f"ALTER TABLE product ADD COLUMN first_received_at {_datetime_column_type}"))
        session.exec(text(
            "UPDATE product SET first_received_at = "
            "(SELECT MIN(log_date) FROM inventorylog WHERE inventorylog.product_id = product.id AND inventorylog.change_type = 'purchase') "
            "WHERE product.id IN (SELECT DISTINCT product_id FROM inventorylog WHERE change_type = 'purchase')"
        ))
        session.commit()

def _ensure_stock_take_schema():
    """盤點單加上盤點人帳號（taker_name / completed_by_name）與每個盤點項目的
    照片（stocktakeitem.images）。既有盤點單的盤點人無從得知，保持 NULL。"""
    with Session(engine) as session:
        alter_statements = []

        st_columns = _table_columns("stocktake")
        if st_columns is not None:
            if "taker_name" not in st_columns:
                alter_statements.append("ALTER TABLE stocktake ADD COLUMN taker_name VARCHAR")
            if "completed_by_name" not in st_columns:
                alter_statements.append("ALTER TABLE stocktake ADD COLUMN completed_by_name VARCHAR")

        item_columns = _table_columns("stocktakeitem")
        if item_columns is not None and "images" not in item_columns:
            alter_statements.append("ALTER TABLE stocktakeitem ADD COLUMN images JSON")

        for statement in alter_statements:
            session.exec(text(statement))

        if alter_statements:
            session.commit()

def _ensure_po_item_shortage_schema():
    """進貨驗收短收原因（poitem.shortage_reason）。既有驗收紀錄沒有這欄，保持 NULL。"""
    with Session(engine) as session:
        columns = _table_columns("poitem")
        if columns is not None and "shortage_reason" not in columns:
            session.exec(text("ALTER TABLE poitem ADD COLUMN shortage_reason VARCHAR"))
            session.commit()

def _ensure_po_item_supplier_schema():
    """採購單各商品的供應商（poitem.supplier_name）。既有項目保持 NULL，沿用採購單的 supplier_name。"""
    with Session(engine) as session:
        columns = _table_columns("poitem")
        if columns is not None and "supplier_name" not in columns:
            session.exec(text("ALTER TABLE poitem ADD COLUMN supplier_name VARCHAR"))
            session.commit()

def _ensure_supplier_rating_schema():
    """供應商評分（supplier.rating 等）。既有供應商一律從滿分 5 星、0 次短收開始。"""
    with Session(engine) as session:
        columns = _table_columns("supplier")
        if columns is None:
            return
        alter_statements = []
        if "rating" not in columns:
            alter_statements.append("ALTER TABLE supplier ADD COLUMN rating FLOAT DEFAULT 5.0 NOT NULL")
        if "shortage_count" not in columns:
            alter_statements.append("ALTER TABLE supplier ADD COLUMN shortage_count INTEGER DEFAULT 0 NOT NULL")
        if "last_shortage_at" not in columns:
            alter_statements.append(f"ALTER TABLE supplier ADD COLUMN last_shortage_at {_datetime_column_type}")
        if "last_shortage_note" not in columns:
            alter_statements.append("ALTER TABLE supplier ADD COLUMN last_shortage_note VARCHAR")
        for statement in alter_statements:
            session.exec(text(statement))
        if alter_statements:
            session.commit()

def _ensure_sales_order_qrcode_schema():
    """出貨單加上蝦皮出貨 QRcode 圖片（salesorder.shopee_qrcode_image）。既有出貨單保持 NULL。"""
    with Session(engine) as session:
        columns = _table_columns("salesorder")
        if columns is not None and "shopee_qrcode_image" not in columns:
            session.exec(text("ALTER TABLE salesorder ADD COLUMN shopee_qrcode_image VARCHAR"))
            session.commit()

def _ensure_so_item_picking_schema():
    """出貨商品逐項撿貨狀態（soitem.picking_status）。既有商品一律視為撿貨中。"""
    with Session(engine) as session:
        columns = _table_columns("soitem")
        if columns is not None and "picking_status" not in columns:
            session.exec(text("ALTER TABLE soitem ADD COLUMN picking_status VARCHAR DEFAULT 'picking' NOT NULL"))
            session.commit()

def _ensure_return_order_schema():
    """退貨單加上經辦人（handled_by）與類型（return_type）。既有退貨單視為退貨退款、經辦人留空。"""
    with Session(engine) as session:
        columns = _table_columns("returnorder")
        if columns is None:
            return
        alter_statements = []
        if "handled_by" not in columns:
            alter_statements.append("ALTER TABLE returnorder ADD COLUMN handled_by VARCHAR")
        if "return_type" not in columns:
            alter_statements.append("ALTER TABLE returnorder ADD COLUMN return_type VARCHAR DEFAULT 'return' NOT NULL")
        for statement in alter_statements:
            session.exec(text(statement))
        if alter_statements:
            session.commit()

def _ensure_transaction_actor_schema():
    """記帳單加上建立者（created_by）與經手者（handled_by）。既有記帳單無從得知，保持 NULL。"""
    with Session(engine) as session:
        columns = _table_columns("transaction")
        if columns is None:
            return
        alter_statements = []
        if "created_by" not in columns:
            alter_statements.append('ALTER TABLE "transaction" ADD COLUMN created_by VARCHAR')
        if "handled_by" not in columns:
            alter_statements.append('ALTER TABLE "transaction" ADD COLUMN handled_by VARCHAR')
        for statement in alter_statements:
            session.exec(text(statement))
        if alter_statements:
            session.commit()

def _ensure_user_extra_permissions_schema():
    """User 加上 extra_permissions（部門之外單獨加的權限）。既有帳號的 permissions 是建立當下
    從部門複製來的快照，回填 extras = permissions − 部門預設權限，之後依部門重算時才不會掉權限。"""
    with Session(engine) as session:
        columns = _table_columns("user")
        if columns is None or "extra_permissions" in columns:
            return
        session.exec(text('ALTER TABLE "user" ADD COLUMN extra_permissions JSON'))
        session.commit()

        from sqlmodel import select
        from backend.models import User
        from backend.user_permissions import extras_from_legacy_permissions

        for user in session.exec(select(User)).all():
            user.extra_permissions = extras_from_legacy_permissions(session, user.department, user.permissions)
            session.add(user)
        session.commit()

def _ensure_void_schema():
    """採購單、出貨單、退貨單加上報廢欄位（void_status 等）。既有單據都是未報廢，保持 NULL。"""
    with Session(engine) as session:
        changed = False
        for table in ("purchaseorder", "salesorder", "returnorder"):
            columns = _table_columns(table)
            if columns is None:
                continue
            for column, column_type in (
                ("void_status", "VARCHAR"), ("void_reason", "VARCHAR"), ("void_requested_by", "VARCHAR"),
                ("voided_by", "VARCHAR"), ("voided_at", _datetime_column_type),
            ):
                if column not in columns:
                    session.exec(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"))
                    changed = True
        if changed:
            session.commit()


PERMISSION_SCHEMA_KEY = "permission_schema_version"
PERMISSION_SCHEMA_VERSION = "2"


def _migrate_permission_catalog():
    """權限改成查看／新增／修改刪除、並拆出子功能（見 user_permissions.LEGACY_EXPANSION）。
    部門預設權限與帳號額外權限都換成新權限，舊的查看權限補上子功能的查看；
    完成後在 SystemSetting 記版本，只跑一次——之後管理者拿掉的子功能權限不會被加回來。"""
    from sqlmodel import select
    from backend.models import Department, SystemSetting, User
    from backend.user_permissions import apply_user_permissions, expand_split_views

    with Session(engine) as session:
        marker = session.get(SystemSetting, PERMISSION_SCHEMA_KEY)
        if marker and marker.value == PERMISSION_SCHEMA_VERSION:
            return
        for dept in session.exec(select(Department)).all():
            dept.default_permissions = expand_split_views(dept.default_permissions)
            session.add(dept)
        session.flush()
        for user in session.exec(select(User)).all():
            user.extra_permissions = expand_split_views(user.extra_permissions)
            apply_user_permissions(session, user)
            session.add(user)
        if marker is None:
            marker = SystemSetting(key=PERMISSION_SCHEMA_KEY, value="", description="權限目錄版本（2 = 查看／新增／修改刪除，依選單拆分子功能）")
        marker.value = PERMISSION_SCHEMA_VERSION
        session.add(marker)
        session.commit()


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _ensure_product_listing_schema()
    _ensure_product_promotion_schema()
    _ensure_password_changed_at_schema()
    _ensure_product_first_received_schema()
    _ensure_stock_take_schema()
    _ensure_po_item_shortage_schema()
    _ensure_po_item_supplier_schema()
    _ensure_supplier_rating_schema()
    _ensure_sales_order_qrcode_schema()
    _ensure_so_item_picking_schema()
    _ensure_return_order_schema()
    _ensure_transaction_actor_schema()
    _ensure_user_extra_permissions_schema()
    _migrate_permission_catalog()
    _ensure_void_schema()

def get_session():
    with Session(engine) as session:
        yield session
