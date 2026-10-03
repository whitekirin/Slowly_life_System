"""Registry of operations exposed to LINE users through the rich menu, the in-chat
menu Flex Message and the LIFF home page.

Every operation belongs to one LineMenuGroup; the rich menu shows one tile per group
the user can use (plus 「全部功能」), tapping a tile replies with that group's Flex
buttons, and each button opens a LIFF page. All three read from this same registry,
so adding a LINE-accessible operation only means registering one more LineAction.

The registry holds the defaults. Labels, subtitles, colours, order and on/off switches
can be overridden from the 「LINE 介面設定」 page (backend/line_menu_config.py); who
sees what is never configurable there and always comes from required_permissions.

Visibility mirrors the staff sider menu in frontend/src/App.tsx — keep the two in
sync. The permission check itself is still enforced by each backend endpoint; this
registry only decides what is shown.
"""
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

from sqlmodel import Session

from backend.auth import has_any_permission
from backend.models import User


@dataclass(frozen=True)
class LineMenuGroup:
    code: str
    label: str
    subtitle: str = ""  # 圖文選單磚塊與按鈕卡上的小字
    color: str = "brown"  # line_menu_config.PALETTE 的色票代碼


@dataclass(frozen=True)
class LineAction:
    code: str
    label: str
    group: str
    # Any one of these grants the action; an empty list means every bound, active user.
    required_permissions: list[str]
    liff_path: str  # appended to the LIFF app's base URL, e.g. "/go?to=/purchase-orders"
    allow_picker: bool = False  # 撿貨人員（含部門繼承）沒有權限也看得到


def staff_page(path: str) -> str:
    """LIFF path that signs the LINE user into the staff system and opens `path` there
    (frontend/src/pages/liff/LiffGo.tsx) — for features without a dedicated LIFF form."""
    return f"/go?to={quote(path, safe='/')}"


LINE_MENU_GROUPS: dict[str, LineMenuGroup] = {}
LINE_ACTIONS: dict[str, LineAction] = {}


def register_group(group: LineMenuGroup) -> None:
    LINE_MENU_GROUPS[group.code] = group


def register_action(action: LineAction) -> None:
    assert action.group in LINE_MENU_GROUPS, f"unknown LINE menu group {action.group}"
    LINE_ACTIONS[action.code] = action


def _is_allowed(action: LineAction, user: User, picker: bool) -> bool:
    if not action.required_permissions:
        return True
    if action.allow_picker and picker:
        return True
    return has_any_permission(user, action.required_permissions)


def list_available_actions(user: User, session: Optional[Session] = None, candidates: Optional[list[LineAction]] = None) -> list[LineAction]:
    """Actions the given user is permitted to use, in display order. `candidates` defaults
    to the 「LINE 介面設定」 menu (enabled actions with their configured labels and groups)
    when a session is given, else the raw registry. Without a session the picker shortcut
    (department-inherited 撿貨人員) can't be checked."""
    if candidates is None:
        if session is not None:
            from backend.line_menu_config import menu_for
            candidates = menu_for(session).actions
        else:
            candidates = list(LINE_ACTIONS.values())
    picker = False
    if session is not None and any(a.allow_picker for a in candidates):
        from backend.pickers import is_picker
        picker = is_picker(session, user)
    return [a for a in candidates if _is_allowed(a, user, picker)]


def group_actions(actions: list[LineAction], groups: Optional[list[LineMenuGroup]] = None) -> list[tuple[LineMenuGroup, list[LineAction]]]:
    """Group actions by menu group, in group order (`groups`, default the registry), skipping empty groups."""
    if groups is None:
        groups = list(LINE_MENU_GROUPS.values())
    return [
        (group, [a for a in actions if a.group == group.code])
        for group in groups
        if any(a.group == group.code for a in actions)
    ]


register_group(LineMenuGroup("purchasing", "採購進貨", "採購單・驗收・供應商", "brown"))
register_group(LineMenuGroup("sales", "出貨撿貨", "出貨・撿貨・退貨", "amber"))
register_group(LineMenuGroup("inventory", "商品庫存", "商品・上架・盤點", "green"))
register_group(LineMenuGroup("approvals", "簽呈核准", "修改與報廢簽呈", "brick"))
register_group(LineMenuGroup("finance", "營運財務", "儀表板・記帳", "slate"))
register_group(LineMenuGroup("members", "會員行銷", "會員・新品・推播", "plum"))
register_group(LineMenuGroup("personal", "通知與設定", "通知・個人・系統", "stone"))

# 採購與進貨
register_action(LineAction("purchase_orders", "採購單", "purchasing", ["view_purchase_orders"], staff_page("/purchase-orders")))
register_action(LineAction("receiving", "進貨驗收", "purchasing", ["view_receiving"], staff_page("/receiving")))
register_action(LineAction("supplementary_receivings", "補驗收單", "purchasing", ["view_supplementary_receivings"], staff_page("/supplementary-receiving")))
register_action(LineAction("suppliers", "供應商管理", "purchasing", ["view_suppliers"], staff_page("/suppliers")))

# 銷售與出貨
register_action(LineAction("shipping", "出貨作業／撿貨", "sales", ["view_shipping"], staff_page("/shipping"), allow_picker=True))
register_action(LineAction("returns", "退貨作業", "sales", ["view_returns"], staff_page("/returns")))

# 商品管理
register_action(LineAction("products", "商品列表", "inventory", ["view_products"], staff_page("/products")))
register_action(LineAction("product_listings", "上架批次管理", "inventory", ["view_product_listings"], staff_page("/product-status")))
register_action(LineAction("categories", "類別管理", "inventory", ["view_categories"], staff_page("/categories")))
register_action(LineAction("stock_takes", "庫存盤點", "inventory", ["view_stock_takes"], staff_page("/stock-take")))

# 簽呈：能對有核准流程的功能送簽呈（有修改權限，核准權限涵蓋修改）的人才看得到
register_action(LineAction(
    "change_requests", "簽呈", "approvals",
    ["edit_purchase_orders", "edit_shipping", "edit_returns"], staff_page("/change-requests"),
))

# 儀表板與財務
register_action(LineAction("dashboard", "儀表板", "finance", ["view_dashboard"], staff_page("/")))
register_action(LineAction("finance", "記帳管理", "finance", ["view_finance"], staff_page("/accounting")))

# 會員管理
register_action(LineAction("members", "會員列表", "members", ["view_members"], staff_page("/members")))
register_action(LineAction("new_products", "新品總覽管理", "members", ["view_new_products"], staff_page("/members/new-products")))
register_action(LineAction("dms", "推播管理 (舊版)", "members", ["view_dms"], staff_page("/admin/dms")))
register_action(LineAction("marketing", "行銷中心", "members", ["view_marketing"], staff_page("/marketing")))

# 通知與設定
register_action(LineAction("notifications", "通知中心", "personal", [], staff_page("/notifications")))
register_action(LineAction("user_settings", "個人設定", "personal", [], staff_page("/settings")))
register_action(LineAction("system_settings", "系統設定", "personal", ["manage_system"], staff_page("/system-settings")))
register_action(LineAction("system_logs", "系統日誌", "personal", ["view_system_logs", "admin"], staff_page("/system-logs")))
