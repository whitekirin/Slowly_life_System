"""員工帳號的有效權限 = 所屬部門的預設權限 ∪ 帳號自己的額外權限（extra_permissions）。

User.permissions 仍是所有權限檢查（has_any_permission、前端 hasPermission）唯一讀的欄位，
這裡負責在部門或額外權限變動時把它重算好，讀取端不用改。
"""
from typing import Iterable, List, Optional

from sqlmodel import Session, select

from backend.models import Department, User

ALL_PERMISSION = "all"


def _create_edit(*modules: str) -> List[str]:
    return [f"{level}_{m}" for m in modules for level in ("create", "edit")]


# 2026-09-27 權限改成「查看／新增／修改刪除」並依選單拆出子功能（上架批次、庫存盤點、補驗收單、
# 新品總覽、推播、行銷中心）。舊的編輯權限 manage_X 一律換成它當時涵蓋的新權限；
# manage_system 不拆，仍是系統設定的權限。
LEGACY_EXPANSION = {
    "manage_products": _create_edit("products", "product_listings", "stock_takes"),
    "manage_categories": _create_edit("categories"),
    "manage_suppliers": _create_edit("suppliers"),
    "manage_purchase_orders": _create_edit("purchase_orders", "supplementary_receivings"),
    "manage_receiving": ["edit_receiving", *_create_edit("supplementary_receivings")],
    "manage_shipping": _create_edit("shipping"),
    "manage_returns": _create_edit("returns"),
    "manage_finance": _create_edit("finance"),
    "manage_members": ["edit_members", "view_new_products", *_create_edit("dms", "marketing")],
}

# 拆出子功能之前，查看權限也看得到那些子功能。只在一次性遷移時展開（database.py），
# 不能放進 normalize_permissions：否則管理者之後想單獨拿掉「查看庫存盤點」會一直被加回來。
SPLIT_VIEW_EXPANSION = {
    "view_products": ["view_product_listings", "view_stock_takes"],
    "view_purchase_orders": ["view_supplementary_receivings"],
    "view_receiving": ["view_supplementary_receivings"],
    "view_members": ["view_new_products", "view_dms"],
}


def normalize_permissions(perms: Optional[Iterable[str]]) -> List[str]:
    """去重並保留順序；舊的 manage_X 換成新權限；含 "all" 時只留 "all"——全部權限與其他權限互斥。"""
    result: List[str] = []
    for p in perms or []:
        for q in LEGACY_EXPANSION.get(p, [p]):
            if q and q not in result:
                result.append(q)
    if ALL_PERMISSION in result:
        return [ALL_PERMISSION]
    return result


def department_permissions(session: Session, department: Optional[str]) -> List[str]:
    if not department:
        return []
    dept = session.exec(select(Department).where(Department.name == department)).first()
    return normalize_permissions(dept.default_permissions) if dept else []


def compute_permissions(dept_perms: Iterable[str], extra_perms: Iterable[str]) -> List[str]:
    return normalize_permissions([*dept_perms, *extra_perms])


def apply_user_permissions(session: Session, user: User) -> None:
    """依 user.department 與 user.extra_permissions 重算 user.permissions（不 commit）。"""
    extras = normalize_permissions(user.extra_permissions)
    user.extra_permissions = extras
    user.permissions = compute_permissions(department_permissions(session, user.department), extras)


def extras_from_legacy_permissions(session: Session, department: Optional[str], permissions: Optional[Iterable[str]]) -> List[str]:
    """舊資料／舊呼叫端只給完整的 permissions：扣掉部門預設權限後剩下的就是額外權限。"""
    dept_perms = set(department_permissions(session, department))
    if ALL_PERMISSION in dept_perms:
        return []
    return normalize_permissions(p for p in (permissions or []) if p not in dept_perms)


def expand_split_views(perms: Optional[Iterable[str]]) -> List[str]:
    """一次性遷移用：舊的查看權限補上拆出去的子功能查看權限。"""
    perms = normalize_permissions(perms)
    extra = [q for p in perms for q in SPLIT_VIEW_EXPANSION.get(p, [])]
    return normalize_permissions([*perms, *extra])
