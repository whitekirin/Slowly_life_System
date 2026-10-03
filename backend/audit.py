"""系統日誌的自動異動紀錄：記下「誰、做了什麼操作、改了系統裡的哪些資料」。

運作方式：
- system_log_middleware（main.py）在每個寫入類請求開始時呼叫 begin_request()，建立這次請求的收集器。
- 這裡掛在 SQLAlchemy Session 上的事件，在 flush 時把新增／修改／刪除的資料列與欄位前後值記下來，
  commit 成功才算數，rollback 就丟掉——日誌只寫真的存進資料庫的變更。
- 請求結束後 middleware 用 build_details() 把收集到的變更組成中文明細寫進 SystemLog。

日誌內容全部是中文：資料表、欄位、狀態代碼都經過下面的對照表翻譯。
新增資料表或欄位時，記得在 TABLE_LABELS / FIELD_LABELS 補上中文名稱，否則明細會出現原始英文欄位名。
"""
from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.orm import Session as SASession


# ---------------------------------------------------------------------------
# 中文對照表
# ---------------------------------------------------------------------------

TABLE_LABELS = {
    "product": "商品", "category": "分類", "attribute": "規格屬性", "attributeoption": "規格選項",
    "productattributelink": "商品規格", "supplier": "供應商",
    "purchaseorder": "採購單", "poitem": "採購商品", "salesorder": "出貨單", "soitem": "出貨商品",
    "returnorder": "退貨單", "returnitem": "退貨商品", "stocktake": "盤點單", "stocktakeitem": "盤點商品",
    "supplementaryreceiving": "補驗收單", "supplementaryreceivingitem": "補驗收商品",
    "transaction": "記帳", "user": "員工帳號", "department": "部門", "systemsetting": "系統設定",
    "member": "會員", "memberaddress": "會員地址", "promotiondm": "促銷 DM", "promotionfavorite": "DM 收藏",
    "messagetemplate": "訊息範本", "targetsegment": "目標分眾", "campaign": "行銷活動",
    "automatedtrigger": "自動觸發規則", "pointexchangeevent": "點數兌換活動", "pointexchangerecord": "點數兌換紀錄",
    "mail_symbols": "會員信件", "changerequest": "簽呈", "productlistingbatch": "商品上架批次",
    "productlistingitem": "上架商品", "userlinebinding": "LINE 綁定",
}

# 這些表是其他操作的附帶紀錄（庫存異動、點數異動、通知……），本身不另外列入明細。
IGNORED_TABLES = {
    "systemlog", "inventorylog", "pointtransactionlog", "supplierratinglog", "campaignlog",
    "lineoauthstate", "usernotification",
}

FIELD_LABELS = {
    # 共用
    "name": "名稱", "description": "說明", "note": "備註", "status": "狀態", "title": "標題",
    "content": "內容", "created_at": "建立時間", "updated_at": "更新時間", "is_active": "是否啟用",
    "email": "電子郵件", "phone": "電話", "address": "地址", "quantity": "數量", "unit_price": "單價",
    "product_id": "商品", "member_id": "會員", "order_id": "所屬單據", "reason": "原因",
    "image_url": "圖片", "metadata_json": "附加資料", "subject": "主旨", "content_html": "內容",
    "key": "設定項目", "value": "設定值",
    # 商品
    "sku": "商品編號", "category_name": "分類", "style": "款式", "attributes": "規格屬性",
    "promotion_image_urls": "推廣圖片", "promotion_copy": "推廣文案", "purchase_url": "購買連結",
    "source_url": "來源連結", "barcode": "條碼", "unit": "單位", "exchange_rate": "匯率",
    "price_rmb": "人民幣價格", "shipping_rmb": "人民幣運費", "shipping_rate_twd": "每公斤運費（台幣）",
    "weight_kg": "重量（公斤）", "batch_quantity": "批量", "cost_price": "成本價", "sales_price": "售價",
    "min_price": "最低價", "max_price": "最高價", "pricing_strategy": "定價策略", "is_confirmed": "是否已確認",
    "stock_quantity": "庫存數量", "safety_stock": "安全庫存", "lead_time_days": "交貨天數",
    "first_received_at": "首次入庫時間",
    "attribute_id": "規格屬性", "option_id": "規格選項",
    # 供應商
    "contact_person": "聯絡人", "website": "網站", "bank_account": "銀行帳號",
    "note_updated_at": "備註更新時間", "rating": "評分", "shortage_count": "短收次數",
    "last_shortage_at": "最近短收時間", "last_shortage_note": "最近短收說明",
    # 採購／出貨／退貨／盤點
    "supplier_name": "供應商", "order_date": "訂單日期", "total_amount": "總金額", "total_weight": "總重量",
    "total_shipping_fee": "總運費", "total_cost": "總成本", "tariff": "關稅", "purchaser_name": "採購人",
    "received_quantity": "已驗收數量", "shortage_reason": "短收原因", "receiving_image": "驗收照片",
    "receiving_video": "驗收影片", "void_status": "報廢狀態", "void_reason": "報廢原因",
    "void_requested_by": "報廢申請人", "voided_by": "報廢執行人", "voided_at": "報廢時間",
    "order_number": "出貨單號", "customer_id": "客戶", "platform": "平台", "total_quantity": "總數量",
    "shipped_by": "出貨人", "shipping_date": "出貨日期", "estimated_arrival": "預計到貨日",
    "earned_points": "回饋點數", "shopee_qrcode_image": "蝦皮出貨 QRcode", "shipping_image": "出貨照片",
    "shipping_video": "出貨影片", "picking_status": "撿貨狀態",
    "return_number": "退貨單號", "return_date": "退貨日期", "return_type": "退貨類型",
    "total_refund_amount": "退款總額", "handled_by": "經手人", "return_image": "退貨照片", "return_video": "退貨影片",
    "return_order_id": "所屬退貨單",
    "taker_name": "盤點人", "completed_by_name": "完成盤點人", "system_quantity": "系統數量",
    "actual_quantity": "實際數量", "images": "照片", "stock_take_id": "所屬盤點單",
    "po_id": "採購單", "created_by_name": "建立人", "received_at": "驗收時間", "received_by_name": "驗收人",
    "supplementary_receiving_id": "所屬補驗收單",
    # 記帳
    "date": "日期", "type": "類型", "category": "類別", "amount": "金額", "payment_method": "付款方式",
    "reference_id": "來源單據", "created_by": "建立人",
    # 員工與部門
    "username": "帳號", "employee_id": "員工編號", "full_name": "姓名", "department": "部門",
    "permissions": "權限", "extra_permissions": "額外權限", "force_password_change": "需強制改密碼",
    "is_superuser": "是否為最高管理者", "settings": "個人設定", "hashed_password": "密碼",
    "password_changed_at": "密碼變更時間", "default_permissions": "部門預設權限",
    "user_id": "員工", "line_user_id": "LINE 使用者", "line_display_name": "LINE 名稱", "line_bound_at": "LINE 綁定時間",
    # 會員
    "gender": "性別", "birthday": "生日", "line_id": "LINE ID", "email_status": "電子郵件狀態",
    "is_subscribed": "是否訂閱", "level": "會員等級", "points": "點數", "total_spent": "累計消費",
    "referral_code": "推薦碼", "referred_by": "推薦人", "social_provider": "社群登入來源", "social_id": "社群帳號",
    "password_hash": "密碼", "last_purchase_date": "最近購買日",
    "recipient_name": "收件人", "recipient_phone": "收件人電話", "is_default": "是否為預設",
    # 行銷／DM／點數
    "link": "連結", "valid_from": "開始日期", "valid_until": "到期日期", "target_levels": "目標會員等級",
    "tags": "標籤", "views": "瀏覽數", "clicks": "點擊數", "dm_id": "DM",
    "filter_rules": "篩選條件", "channels": "發送管道", "segment_id": "目標分眾", "scheduled_at": "排程時間",
    "sent_count": "已發送數", "open_count": "開啟數", "click_count": "點擊數",
    "event_type": "觸發事件", "template_id": "訊息範本", "condition_rules": "觸發條件",
    "required_points": "所需點數", "discount_code_template": "折扣碼格式", "discount_rate": "折扣",
    "valid_days": "有效天數", "min_spend": "最低消費", "event_id": "兌換活動", "points_used": "使用點數",
    "symbol_type": "信件類型", "is_read": "是否已讀", "read_at": "讀取時間",
    # 簽呈
    "resource_type": "單據類型", "resource_id": "單據編號", "action": "申請項目", "attachment_url": "附件",
    "requester_id": "申請人", "requester_name": "申請人", "approver_id": "核准人", "approver_name": "核准人",
    "decided_at": "決定時間", "decision_note": "核准意見", "expires_at": "到期時間",
    "max_uses": "可使用次數", "used_count": "已使用次數",
    # 上架
    "created_by_id": "建立人", "published_at": "上架時間", "archived_at": "封存時間", "batch_id": "上架批次",
}

# 狀態、類型這類代碼欄位的中文值
CODE_FIELDS = {
    "status", "void_status", "picking_status", "type", "return_type", "platform", "gender", "level",
    "email_status", "action", "resource_type", "event_type", "symbol_type", "payment_method",
    "pricing_strategy", "channels", "target_levels", "unit",
}
VALUE_LABELS = {
    "draft": "草稿", "pending": "待處理", "approved": "已核准", "received": "已驗收", "completed": "已完成",
    "shipped": "已出貨", "cancelled": "已取消", "rejected": "已駁回", "published": "已發佈",
    "unpublished": "已下架", "reviewing": "審核中", "archived": "已封存", "active": "有效", "used": "已使用",
    "expired": "已過期", "scheduled": "已排程", "processing": "處理中", "failed": "失敗", "sent": "已發送",
    "opened": "已開啟", "clicked": "已點擊", "picking": "撿貨中", "picked": "已撿貨", "voided": "已報廢",
    "success": "成功", "failure": "失敗",
    "income": "收入", "expense": "支出", "return": "退貨退款", "refund_only": "僅退款",
    "manual": "手動建立", "shopee": "蝦皮", "amazon": "Amazon",
    "Male": "男", "Female": "女", "Other": "其他",
    "Bronze": "銅級", "Silver": "銀級", "Gold": "金級", "Platinum": "白金級", "VIP": "VIP", "all": "全部",
    "edit": "修改", "void": "報廢", "delete": "刪除",
    "purchase_order": "採購單", "sales_order": "出貨單", "return_order": "退貨單", "transaction": "記帳",
    "birthday": "生日", "register": "註冊", "points_expire": "點數到期",
    "email": "電子郵件", "line": "LINE", "sms": "簡訊", "piece": "個",
}

# 不列入明細的欄位（自動維護的時間戳、流水號）
SKIPPED_FIELDS = {"id", "created_at", "updated_at", "note_updated_at", "password_changed_at", "timestamp"}
# 密碼類欄位只說「已變更」，不寫出雜湊值
SECRET_FIELDS = {"hashed_password", "password_hash"}

# 外鍵欄位 → 被參照的資料表，明細顯示對方名稱而不是編號
FOREIGN_KEYS = {
    "product_id": "product", "member_id": "member", "user_id": "user", "attribute_id": "attribute",
    "option_id": "attributeoption", "segment_id": "targetsegment", "template_id": "messagetemplate",
    "event_id": "pointexchangeevent", "dm_id": "promotiondm", "po_id": "purchaseorder",
    "requester_id": "user", "approver_id": "user", "created_by_id": "user",
}
# 子項目所屬的主單據欄位：明細寫成「採購單 PO-3 的採購商品」
PARENT_KEYS = {
    "poitem": ("order_id", "purchaseorder"), "soitem": ("order_id", "salesorder"),
    "returnitem": ("return_order_id", "returnorder"), "stocktakeitem": ("stock_take_id", "stocktake"),
    "supplementaryreceivingitem": ("supplementary_receiving_id", "supplementaryreceiving"),
    "productlistingitem": ("batch_id", "productlistingbatch"),
}

# 請求路徑第一段 → 功能名稱（日誌的「功能」欄）
RESOURCE_LABELS = {
    "products": "商品管理", "product-listings": "商品上架", "categories": "商品分類", "attributes": "規格屬性",
    "attribute_options": "規格屬性", "suppliers": "供應商", "purchase_orders": "採購單", "sales_orders": "出貨單",
    "return_orders": "退貨單", "stock_takes": "盤點", "supplementary_receivings": "補驗收",
    "transactions": "記帳", "users": "員工帳號", "departments": "部門", "system-settings": "系統設定",
    "members": "會員", "dms": "促銷 DM", "marketing": "行銷", "api": "會員服務", "line": "LINE",
    "liff": "LINE 操作", "user_notifications": "通知", "change_requests": "簽呈", "upload": "檔案上傳",
    "auth": "帳號驗證", "inventory": "庫存", "dashboard": "儀表板", "pickers": "撿貨",
    "system_logs": "系統日誌", "system-logs": "系統日誌", "member": "會員",
    # 舊紀錄用過的 resource 代碼
    "purchase_order": "採購單", "sales_order": "出貨單",
}

ACTION_LABELS = {
    "create": "新增", "update": "修改", "delete": "刪除", "login": "登入", "logout": "登出",
    "export": "匯出", "query": "查詢", "void": "報廢", "submit": "送出簽呈", "approve": "核准",
    "reject": "駁回", "cancel": "取消", "auto_transaction": "自動記帳", "upload": "上傳", "operate": "操作",
}

STATUS_LABELS = {"success": "成功", "failure": "失敗"}

# 端點（路由函式名稱）→ (動作代碼, 中文操作名稱)
OPERATIONS = {
    "register_member": ("create", "會員註冊"), "login_member": ("login", "會員登入"),
    "update_member_me": ("update", "會員修改個人資料"), "create_address": ("create", "會員新增地址"),
    "update_member_admin": ("update", "修改會員資料"), "sync_member_manual": ("update", "同步會員資料"),
    "create_dm": ("create", "新增促銷 DM"), "update_dm": ("update", "修改促銷 DM"), "delete_dm": ("delete", "刪除促銷 DM"),
    "toggle_favorite": ("update", "會員收藏／取消收藏 DM"),
    "create_mail_symbol": ("create", "寄送會員信件"), "exchange_points": ("create", "會員兌換點數"),
    "create_template": ("create", "新增訊息範本"), "update_template": ("update", "修改訊息範本"),
    "delete_template": ("delete", "刪除訊息範本"), "create_segment": ("create", "新增目標分眾"),
    "update_segment": ("update", "修改目標分眾"), "delete_segment": ("delete", "刪除目標分眾"),
    "direct_send_message": ("create", "直接發送行銷訊息"), "create_campaign": ("create", "新增行銷活動"),
    "update_campaign_status": ("update", "變更行銷活動狀態"), "create_trigger": ("create", "新增自動觸發規則"),
    "delete_trigger": ("delete", "刪除自動觸發規則"),
    "start_line_bind": ("update", "開始綁定 LINE"), "unbind_line": ("delete", "解除 LINE 綁定"),
    "liff_create_purchase_order": ("create", "從 LINE 建立採購單"),
    "sync_rich_menus": ("update", "同步 LINE 圖文選單"),
    "create_supplementary_receiving": ("create", "建立補驗收單"),
    "receive_supplementary_receiving": ("update", "補驗收入庫"),
    "create_change_request": ("submit", "送出簽呈"), "approve_change_request": ("approve", "核准簽呈"),
    "reject_change_request": ("reject", "駁回簽呈"), "cancel_change_request": ("cancel", "取消簽呈"),
    "forgot_password": ("update", "申請重設密碼"), "reset_password": ("update", "重設密碼"),
    "upload_file": ("upload", "上傳檔案"),
    "create_attribute": ("create", "新增規格屬性"), "delete_attribute": ("delete", "刪除規格屬性"),
    "create_attribute_option": ("create", "新增規格選項"), "delete_attribute_option": ("delete", "刪除規格選項"),
    "ensure_attribute_option": ("create", "新增規格選項"),
    "create_product": ("create", "新增商品"), "update_product": ("update", "修改商品"),
    "delete_product": ("delete", "刪除商品"), "ensure_product": ("create", "新增商品"),
    "create_product_listing": ("create", "建立商品上架批次"), "publish_product_listing": ("update", "上架商品"),
    "archive_product_listing": ("update", "封存商品上架批次"),
    "create_category": ("create", "新增商品分類"), "delete_category": ("delete", "刪除商品分類"),
    "create_supplier": ("create", "新增供應商"), "update_supplier": ("update", "修改供應商"),
    "delete_supplier": ("delete", "刪除供應商"),
    "create_po": ("create", "新增採購單"), "update_po": ("update", "修改採購單"), "void_po": ("void", "報廢採購單"),
    "create_so": ("create", "新增出貨單"), "update_so": ("update", "修改出貨單"),
    "update_item_picking_status": ("update", "變更商品撿貨狀態"),
    "update_picking_status": ("update", "變更出貨單撿貨狀態"), "void_so": ("void", "報廢出貨單"),
    "create_return_order": ("create", "新增退貨單"), "update_return_order": ("update", "修改退貨單"),
    "delete_return_order": ("delete", "刪除退貨單"), "void_ro": ("void", "報廢退貨單"),
    "create_stock_take": ("create", "新增盤點單"), "update_stock_take": ("update", "修改盤點單"),
    "complete_stock_take": ("update", "完成盤點"), "delete_stock_take": ("delete", "刪除盤點單"),
    "update_user_me": ("update", "修改個人帳號設定"), "create_user": ("create", "新增員工帳號"),
    "update_user": ("update", "修改員工帳號"), "delete_user": ("delete", "刪除員工帳號"),
    "create_department": ("create", "新增部門"), "update_department": ("update", "修改部門"),
    "delete_department": ("delete", "刪除部門"), "update_system_setting": ("update", "修改系統設定"),
    "create_transaction": ("create", "新增記帳"), "update_transaction": ("update", "修改記帳"),
    "delete_transaction": ("delete", "刪除記帳"),
}

# 即使沒有改到資料也要記錄的操作（例如上傳檔案、發送訊息）
ALWAYS_LOG_ENDPOINTS = {"upload_file", "direct_send_message", "forgot_password", "sync_rich_menus"}

# 高頻、非人為操作的端點，不寫日誌（DM 瀏覽／點擊計數、已讀標記、LINE webhook）；
# liff_session 跟 /token 一樣自己記登入（middleware 從 LINE 的 token 認不出是誰）
SKIPPED_ENDPOINTS = {
    "track_view", "track_click", "mark_read", "mark_all_read", "mark_mail_symbol_read", "line_webhook",
    "liff_session",
}

HTTP_FAILURE_LABELS = {
    400: "資料不符合規則或目前狀態不允許此操作", 401: "未登入或登入已過期", 403: "權限不足",
    404: "找不到指定的資料", 409: "資料衝突", 413: "檔案太大", 422: "送出的資料格式不正確",
    429: "操作太頻繁，請稍後再試",
}

MAX_VALUE_LENGTH = 80


def action_label(code: Optional[str]) -> str:
    return ACTION_LABELS.get(code or "", code or "")


def resource_label(code: Optional[str]) -> str:
    return RESOURCE_LABELS.get(code or "", code or "")


def status_label(code: Optional[str]) -> str:
    return STATUS_LABELS.get(code or "", code or "")


def failure_label(status_code: int) -> str:
    if status_code >= 500:
        return "系統內部錯誤"
    return HTTP_FAILURE_LABELS.get(status_code, "操作未完成")


# ---------------------------------------------------------------------------
# 每個請求的收集器
# ---------------------------------------------------------------------------

@dataclass
class AuditContext:
    pending: list = field(default_factory=list)    # 已 flush、尚未 commit 的變更 [(session_id, change)]
    committed: list = field(default_factory=list)  # 已 commit 的變更
    bind: Any = None                               # 請求實際使用的資料庫引擎（日誌寫在同一個庫）
    explicit_logs: int = 0                         # 業務程式自己寫的 SystemLog 筆數
    closed: bool = False


_current: contextvars.ContextVar[Optional[AuditContext]] = contextvars.ContextVar("audit_context", default=None)


def begin_request() -> AuditContext:
    ctx = AuditContext()
    _current.set(ctx)
    return ctx


def end_request(ctx: AuditContext) -> None:
    ctx.closed = True
    _current.set(None)


def _active() -> Optional[AuditContext]:
    ctx = _current.get()
    if ctx is None or ctx.closed:
        return None
    return ctx


# ---------------------------------------------------------------------------
# 把資料列、欄位值翻成中文
# ---------------------------------------------------------------------------

def _table_name(obj) -> Optional[str]:
    table = getattr(obj, "__table__", None)
    return table.name if table is not None else None


def _lookup(session, table: str, pk) -> Optional[object]:
    """找被參照的資料列（例如子項目的商品）：先找 session 已載入的，沒有再查資料庫（不觸發 autoflush）。"""
    if pk is None or session is None:
        return None
    for obj in list(session.identity_map.values()):
        if _table_name(obj) == table and getattr(obj, "id", None) == pk:
            return obj
    model = _MODELS_BY_TABLE.get(table)
    if model is None:
        return None
    try:
        with session.no_autoflush:
            return session.get(model, pk)
    except Exception:
        return None


def _models_by_table() -> dict:
    from sqlmodel import SQLModel
    import backend.models  # noqa: F401  確保所有 model 已註冊
    return {
        mapper.local_table.name: mapper.class_
        for mapper in SQLModel._sa_registry.mappers
        if getattr(mapper, "local_table", None) is not None
    }


class _LazyModels(dict):
    def get(self, key, default=None):
        if not self:
            self.update(_models_by_table())
        return super().get(key, default)


_MODELS_BY_TABLE = _LazyModels()


_NAME_ATTRS = ("order_number", "return_number", "name", "title", "full_name", "username", "subject",
               "key", "phone", "recipient_name")


def _entity_name(obj) -> str:
    """資料列的辨識名稱，例如 商品「藍色馬克杯」、採購單 PO-3。"""
    table = _table_name(obj)
    pk = getattr(obj, "id", None)
    if table == "purchaseorder":
        return f"PO-{pk}"
    for attr in _NAME_ATTRS:
        value = getattr(obj, attr, None)
        if value:
            return f"「{value}」"
    if table == "changerequest":
        return f"#{pk}"
    return f"#{pk}" if pk is not None else ""


def _describe_entity(session, obj) -> str:
    table = _table_name(obj)
    label = TABLE_LABELS.get(table, table)
    parent = PARENT_KEYS.get(table)
    if parent:
        parent_obj = _lookup(session, parent[1], getattr(obj, parent[0], None))
        product = _lookup(session, "product", getattr(obj, "product_id", None))
        item_name = _entity_name(product) if product is not None else f" #{getattr(obj, 'product_id', '')}"
        prefix = ""
        if parent_obj is not None:
            prefix = f"{TABLE_LABELS[parent[1]]} {_entity_name(parent_obj)} 的"
        elif getattr(obj, parent[0], None) is not None:
            prefix = f"{TABLE_LABELS[parent[1]]} #{getattr(obj, parent[0])} 的"
        return f"{prefix}{label}{item_name}"
    if table == "productattributelink":
        product = _lookup(session, "product", getattr(obj, "product_id", None))
        return f"商品{_entity_name(product) if product is not None else ''}的規格"
    return f"{label} {_entity_name(obj)}".strip()


def _format_value(session, field_name: str, value) -> str:
    if value is None or value == "" or value == [] or value == {}:
        return "（空）"
    if isinstance(value, bool):
        return "是" if value else "否"
    if field_name in FOREIGN_KEYS and isinstance(value, int):
        ref = _lookup(session, FOREIGN_KEYS[field_name], value)
        if ref is not None:
            return _entity_name(ref).strip("「」") or f"#{value}"
        return f"#{value}"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M") if (value.hour or value.minute) else value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float):
        return f"{value:g}"
    if field_name in CODE_FIELDS:
        if isinstance(value, list):
            return "、".join(VALUE_LABELS.get(str(v), str(v)) for v in value)
        if isinstance(value, str):
            return VALUE_LABELS.get(value, value)
    if isinstance(value, list):
        text = "、".join(str(v) for v in value)
    elif isinstance(value, dict):
        text = "、".join(f"{k}：{v}" for k, v in value.items())
    else:
        text = str(value)
    text = text.replace("\n", " ")
    if len(text) > MAX_VALUE_LENGTH:
        text = text[:MAX_VALUE_LENGTH] + "…"
    return text


def _field_label(name: str) -> str:
    return FIELD_LABELS.get(name, name)


def _column_keys(obj) -> list[str]:
    return [attr.key for attr in sa_inspect(obj).mapper.column_attrs]


def _describe_created(session, obj) -> str:
    parts = []
    parent = PARENT_KEYS.get(_table_name(obj))
    hidden = set(SKIPPED_FIELDS)
    if parent:
        hidden |= {parent[0], "product_id"}  # 已經寫在標題裡
    name_attr = next((a for a in _NAME_ATTRS if getattr(obj, a, None)), None)
    if name_attr:
        hidden.add(name_attr)  # 名稱已經寫在標題裡
    for key in _column_keys(obj):
        if key in hidden or key in SECRET_FIELDS:
            continue
        value = getattr(obj, key, None)
        # 空值、0、否這類預設值不列，只留有意義的內容
        if value is None or value == "" or value == [] or value == {} or value is False:
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
            continue
        parts.append(f"{_field_label(key)}：{_format_value(session, key, value)}")
    head = f"新增{_describe_entity(session, obj)}"
    return f"{head}（{'，'.join(parts)}）" if parts else head


def _describe_updated(session, obj) -> Optional[str]:
    state = sa_inspect(obj)
    changes = []
    for key in _column_keys(obj):
        if key in SKIPPED_FIELDS:
            continue
        history = state.attrs[key].history
        if not history.has_changes():
            continue
        new = history.added[0] if history.added else None
        if history.deleted:
            old = history.deleted[0]
        elif history.unchanged:
            old = history.unchanged[0]
        else:
            old = None
        if old == new:
            continue
        if key in SECRET_FIELDS:
            changes.append("密碼已變更")
            continue
        changes.append(f"{_field_label(key)}：{_format_value(session, key, old)} → {_format_value(session, key, new)}")
    if not changes:
        return None
    return f"修改{_describe_entity(session, obj)}：{'，'.join(changes)}"


def _describe_deleted(session, obj) -> str:
    return f"刪除{_describe_entity(session, obj)}"


# ---------------------------------------------------------------------------
# SQLAlchemy 事件
# ---------------------------------------------------------------------------

@event.listens_for(SASession, "before_flush")
def _before_flush(session, flush_context, instances):
    ctx = _active()
    if ctx is None:
        return
    try:
        # before_flush 還看得到欄位的舊值；新增資料的 id 此時還沒產生，改在 after_flush 補描述
        for obj in list(session.dirty) + list(session.deleted):
            table = _table_name(obj)
            if table is None or table in IGNORED_TABLES:
                continue
            if obj in session.deleted:
                ctx.pending.append((id(session), ("delete", _describe_deleted(session, obj))))
            elif session.is_modified(obj, include_collections=False):
                text = _describe_updated(session, obj)
                if text:
                    ctx.pending.append((id(session), ("update", text)))
        session.info["audit_new"] = list(session.new)
    except Exception as exc:  # 日誌失敗不能影響正常操作
        print(f"audit before_flush failed: {exc}")


@event.listens_for(SASession, "after_flush")
def _after_flush(session, flush_context):
    ctx = _active()
    if ctx is None:
        return
    try:
        for obj in session.info.pop("audit_new", []):
            table = _table_name(obj)
            if table == "systemlog":
                ctx.explicit_logs += 1
                continue
            if table is None or table in IGNORED_TABLES:
                continue
            ctx.pending.append((id(session), ("create", _describe_created(session, obj))))
    except Exception as exc:
        print(f"audit after_flush failed: {exc}")


@event.listens_for(SASession, "after_begin")
def _after_begin(session, transaction, connection):
    ctx = _active()
    if ctx is not None and ctx.bind is None:
        ctx.bind = connection.engine


@event.listens_for(SASession, "after_commit")
def _after_commit(session):
    ctx = _active()
    if ctx is None:
        return
    sid = id(session)
    ctx.committed.extend(change for owner, change in ctx.pending if owner == sid)
    ctx.pending = [(owner, change) for owner, change in ctx.pending if owner != sid]


@event.listens_for(SASession, "after_rollback")
def _after_rollback(session):
    ctx = _active()
    if ctx is None:
        return
    sid = id(session)
    ctx.pending = [(owner, change) for owner, change in ctx.pending if owner != sid]


# ---------------------------------------------------------------------------
# 組出日誌內容
# ---------------------------------------------------------------------------

def resolve_operation(endpoint_name: Optional[str], method: str, ctx: AuditContext) -> tuple[str, str]:
    """回傳 (動作代碼, 中文操作名稱)。"""
    if endpoint_name in OPERATIONS:
        return OPERATIONS[endpoint_name]
    kinds = {kind for kind, _ in ctx.committed}
    if kinds == {"delete"} or method == "DELETE":
        return "delete", "刪除資料"
    if kinds == {"create"}:
        return "create", "新增資料"
    if method in {"PUT", "PATCH"} or "update" in kinds:
        return "update", "修改資料"
    return "operate", "操作"


def build_details(operation: str, ctx: AuditContext, failure: Optional[str] = None) -> str:
    lines = [operation + ("失敗" if failure else "")]
    if failure:
        lines.append(f"原因：{failure}")
        return "\n".join(lines)
    texts = []
    for _, text in ctx.committed:
        if text not in texts:
            texts.append(text)
    # 單據修改時商品明細常是「整批刪掉再重建」，同一個品項的刪除＋新增合併成一行「更新」
    deleted = {t[len("刪除"):] for t in texts if t.startswith("刪除")}
    recreated = set()
    for text in texts:
        if text.startswith("新增"):
            target = text[len("新增"):].split("（", 1)[0]
            if target in deleted:
                recreated.add(target)
    for text in texts:
        if text.startswith("刪除") and text[len("刪除"):] in recreated:
            continue
        if text.startswith("新增") and text[len("新增"):].split("（", 1)[0] in recreated:
            text = "更新" + text[len("新增"):]
        lines.append(f"・{text}")
    if len(lines) == 1:
        lines.append("・沒有資料被變更")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 舊紀錄（改版前寫入的英文內容）轉成中文顯示
# ---------------------------------------------------------------------------

_LEGACY_DETAILS = {
    "Login successful": "登入系統",
    "Login failed": "登入失敗\n原因：帳號或密碼錯誤",
    "Exported system logs": "匯出系統日誌",
}


def translate_legacy_details(details: Optional[str], action: Optional[str], resource: Optional[str], status: Optional[str]) -> Optional[str]:
    if not details:
        return details
    if details in _LEGACY_DETAILS:
        return _LEGACY_DETAILS[details]
    # 舊版 middleware 格式："POST /products/3 | status_code=200"（可能帶 "| error=..."）
    head = details.split(" | ", 1)[0].split(" ")
    if len(head) == 2 and head[0] in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} and head[1].startswith("/"):
        text = f"{action_label(action)}{resource_label(resource)}（舊版紀錄，未記錄異動明細）"
        if status == "failure":
            code = None
            for part in details.split(" | ")[1:]:
                if part.startswith("status_code="):
                    try:
                        code = int(part.split("=", 1)[1])
                    except ValueError:
                        pass
            text += f"\n結果：失敗（{failure_label(code or 500)}）"
        return text
    if details.startswith("Updated member "):
        rest = details[len("Updated member "):]
        member_id, _, changes = rest.partition(". Changes: ")
        try:
            parsed = json.loads(changes.replace("'", '"').replace("True", "true").replace("False", "false").replace("None", "null"))
            changes = "，".join(f"{_field_label(k)}：{_format_value(None, k, v) if k not in FOREIGN_KEYS else v}" for k, v in parsed.items())
        except Exception:
            pass
        return f"修改會員 #{member_id}：{changes}"
    return details
