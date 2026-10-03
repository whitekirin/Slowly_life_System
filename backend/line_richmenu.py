"""依權限切換的 LINE 圖文選單（rich menu）。

每個綁定帳號看到的選單 = 他看得到的功能分組各一格，加一格「全部功能」；分組的名稱、副標、顏色、順序、
開關來自「LINE 介面設定」（line_menu_config.py），圖由 line_menu_render.py 即時畫。
點分組會送 postback `menu=<分組>`，webhook 回該分組的按鈕卡。未綁定的人看到頻道預設選單（引導綁定）。

同樣內容的一組磚塊只建一次圖文選單，rich_menu_id 存在 LineRichMenu（signature 含內容的雜湊，改了設定
就會變），之後只做 link。全部重新同步時，順便把已經沒有人用的舊選單從 LINE 刪掉。
權限、部門、啟用狀態、綁定變動時呼叫 sync_user_rich_menu；呼叫端不應因 LINE API 失敗而失敗，
所以這裡的函式都不丟例外，只寫 line_delivery.log。LINE_SUPPRESS_SEND 時不打 LINE API。
"""
import hashlib
import json
from typing import Optional

import httpx
from sqlmodel import Session, select

from backend.config import settings
from backend.line_actions import group_actions, list_available_actions
from backend.line_menu_config import ResolvedMenu, menu_for
from backend.line_menu_render import COLUMNS, TILE_H, TILE_W, render_rich_menu, render_unbound
from backend.line_utils import line_logger
from backend.models import LineRichMenu, User, UserLineBinding

LAYOUT_VERSION = "v2"  # 改了畫法或版面就遞增，讓舊的 rich menu 不再被重用
UNBOUND_SIGNATURE = f"{LAYOUT_VERSION}:unbound"
POSTBACK_PREFIX = "menu="
UNBOUND_POSTBACK = "menu=bind_help"

RICHMENU_URL = "https://api.line.me/v2/bot/richmenu"
RICHMENU_CONTENT_URL = "https://api-data.line.me/v2/bot/richmenu/{rich_menu_id}/content"
USER_RICHMENU_URL = "https://api.line.me/v2/bot/user/{line_user_id}/richmenu"
DEFAULT_RICHMENU_URL = "https://api.line.me/v2/bot/user/all/richmenu/{rich_menu_id}"


def _headers(content_type: str = "application/json") -> dict:
    return {"Authorization": f"Bearer {settings.LINE_MESSAGING_ACCESS_TOKEN}", "Content-Type": content_type}


def liff_url(path: str = "") -> str:
    return f"https://liff.line.me/{settings.LIFF_ID}{path}"


def user_tiles(session: Session, user: User, menu: Optional[ResolvedMenu] = None) -> list[str]:
    """使用者圖文選單上的磚塊（分組代碼，依序，最後是 "all"）；沒有任何可用功能時是空的。"""
    menu = menu or menu_for(session)
    groups = [group for group, _ in group_actions(list_available_actions(user, session, menu.actions), menu.groups)]
    return [g.code for g in groups][: COLUMNS * 2 - 1] + ["all"] if groups else []


def menu_signature(tiles: list[str], menu: ResolvedMenu) -> str:
    """同樣內容（磚塊順序、文字、顏色）就共用同一個 LINE 圖文選單。"""
    groups = {g.code: g for g in menu.groups}
    content = [[t, groups[t].label, groups[t].subtitle, groups[t].color] for t in tiles if t in groups]
    content.append(["all", menu.all_tile["label"], menu.all_tile["subtitle"]])
    digest = hashlib.sha1(json.dumps(content, ensure_ascii=False).encode("utf-8")).hexdigest()[:10]
    return f"{LAYOUT_VERSION}:{','.join(tiles)}:{digest}"


def build_rich_menu(tiles: list[str], menu: Optional[ResolvedMenu] = None) -> tuple[dict, bytes]:
    """回傳 (rich menu 定義, PNG 圖)。一列 4 格，超過 4 格就兩列；空位只有底色、不設點擊區。
    menu 不給就用預設的「LINE 介面設定」。"""
    if menu is None:
        from backend.line_menu_config import default_config, resolve_menu
        menu = resolve_menu(default_config())
    groups = {g.code: g for g in menu.groups}
    tile_groups = [groups[t] for t in tiles if t in groups]
    image, rows = render_rich_menu(tile_groups, menu.all_tile)

    areas = []
    for i, tile in enumerate([g.code for g in tile_groups] + ["all"]):
        x, y = (i % COLUMNS) * TILE_W, (i // COLUMNS) * TILE_H
        if tile == "all":
            action = {"type": "uri", "label": menu.all_tile["label"][:20], "uri": liff_url()}
        else:
            action = {"type": "postback", "label": groups[tile].label[:20], "data": f"{POSTBACK_PREFIX}{tile}"}
        areas.append({"bounds": {"x": x, "y": y, "width": TILE_W, "height": TILE_H}, "action": action})

    definition = {
        "size": {"width": TILE_W * COLUMNS, "height": TILE_H * rows},
        "selected": True,
        "name": f"staff {','.join(tiles)}"[:300],
        "chatBarText": "功能選單",
        "areas": areas,
    }
    return definition, image


def build_unbound_rich_menu() -> tuple[dict, bytes]:
    image_bytes = render_unbound()
    width, height = TILE_W * COLUMNS, TILE_H
    definition = {
        "size": {"width": width, "height": height},
        "selected": True,
        "name": "unbound",
        "chatBarText": "帳號綁定",
        "areas": [{
            "bounds": {"x": 0, "y": 0, "width": width, "height": height},
            "action": {"type": "postback", "label": "綁定說明", "data": UNBOUND_POSTBACK},
        }],
    }
    return definition, image_bytes


def _create_on_line(client: httpx.Client, definition: dict, image: bytes) -> str:
    response = client.post(RICHMENU_URL, json=definition, headers=_headers())
    response.raise_for_status()
    rich_menu_id = response.json()["richMenuId"]
    try:
        client.post(
            RICHMENU_CONTENT_URL.format(rich_menu_id=rich_menu_id), content=image, headers=_headers("image/png"),
        ).raise_for_status()
    except Exception:
        # 沒圖的 rich menu 不能 link，刪掉免得占 LINE 的 1000 個上限
        client.delete(f"{RICHMENU_URL}/{rich_menu_id}", headers=_headers())
        raise
    return rich_menu_id


def _get_or_create(session: Session, client: httpx.Client, signature: str, build) -> str:
    cached = session.get(LineRichMenu, signature)
    if cached:
        return cached.rich_menu_id
    definition, image = build()
    rich_menu_id = _create_on_line(client, definition, image)
    session.add(LineRichMenu(signature=signature, rich_menu_id=rich_menu_id))
    session.commit()
    line_logger.info(f"LINE_RICHMENU_CREATED signature={signature} rich_menu_id={rich_menu_id}")
    return rich_menu_id


def _unlink(client: httpx.Client, line_user_id: str) -> None:
    response = client.delete(USER_RICHMENU_URL.format(line_user_id=line_user_id), headers=_headers())
    if response.status_code != 404:  # 本來就沒有個人選單
        response.raise_for_status()


def sync_user_rich_menu(
    session: Session, user: User, line_user_id: Optional[str] = None,
    menu: Optional[ResolvedMenu] = None, used_signatures: Optional[set] = None,
) -> Optional[str]:
    """讓使用者的 LINE 圖文選單符合他目前的權限與「LINE 介面設定」。line_user_id 不給就查綁定；沒綁定就什麼都不做。
    停用或沒有任何可用功能的帳號改回預設選單（unlink）。回傳 link 的 rich_menu_id，失敗或 unlink 時回 None。
    used_signatures：全部重新同步時收集還有人用的選單，用來清掉舊的。"""
    try:
        if line_user_id is None:
            binding = session.get(UserLineBinding, user.id)
            if not binding:
                return None
            line_user_id = binding.line_user_id

        menu = menu or menu_for(session)
        tiles = user_tiles(session, user, menu) if user.is_active else []
        signature = menu_signature(tiles, menu)
        if used_signatures is not None and tiles:
            used_signatures.add(signature)

        if settings.LINE_SUPPRESS_SEND:
            line_logger.info(f"LINE_MOCK_RICHMENU user={user.username} recipient={line_user_id} tiles={signature} response=suppressed_by_config")
            return None

        with httpx.Client(timeout=15.0) as client:
            if not tiles:
                _unlink(client, line_user_id)
                line_logger.info(f"LINE_RICHMENU_UNLINKED user={user.username} recipient={line_user_id}")
                return None
            rich_menu_id = _get_or_create(session, client, signature, lambda: build_rich_menu(tiles, menu))
            response = client.post(
                f"{USER_RICHMENU_URL.format(line_user_id=line_user_id)}/{rich_menu_id}", headers=_headers(),
            )
            if response.status_code == 404:
                # 有人在 LINE 後台手動刪了這個選單：丟掉快取重建一次
                session.delete(session.get(LineRichMenu, signature))
                session.commit()
                rich_menu_id = _get_or_create(session, client, signature, lambda: build_rich_menu(tiles, menu))
                response = client.post(
                    f"{USER_RICHMENU_URL.format(line_user_id=line_user_id)}/{rich_menu_id}", headers=_headers(),
                )
            response.raise_for_status()
        line_logger.info(f"LINE_RICHMENU_LINKED user={user.username} recipient={line_user_id} tiles={signature} rich_menu_id={rich_menu_id}")
        return rich_menu_id
    except Exception as e:
        session.rollback()
        error_msg = str(e).replace("\n", " ")
        line_logger.error(f"LINE_RICHMENU_FAILED user={user.username} recipient={line_user_id} reason='{error_msg}'")
        return None


def unlink_rich_menu(line_user_id: str) -> None:
    """解除綁定後改回頻道預設選單。"""
    if settings.LINE_SUPPRESS_SEND:
        line_logger.info(f"LINE_MOCK_RICHMENU_UNLINK recipient={line_user_id} response=suppressed_by_config")
        return
    try:
        with httpx.Client(timeout=15.0) as client:
            _unlink(client, line_user_id)
        line_logger.info(f"LINE_RICHMENU_UNLINKED recipient={line_user_id}")
    except Exception as e:
        error_msg = str(e).replace("\n", " ")
        line_logger.error(f"LINE_RICHMENU_UNLINK_FAILED recipient={line_user_id} reason='{error_msg}'")


def ensure_default_rich_menu(session: Session) -> Optional[str]:
    """把「尚未綁定」選單設為頻道預設（沒有個人選單的人都看到它）。失敗回 None。"""
    if settings.LINE_SUPPRESS_SEND:
        line_logger.info("LINE_MOCK_RICHMENU_DEFAULT response=suppressed_by_config")
        return None
    try:
        with httpx.Client(timeout=15.0) as client:
            rich_menu_id = _get_or_create(session, client, UNBOUND_SIGNATURE, build_unbound_rich_menu)
            client.post(DEFAULT_RICHMENU_URL.format(rich_menu_id=rich_menu_id), headers=_headers()).raise_for_status()
        line_logger.info(f"LINE_RICHMENU_DEFAULT_SET rich_menu_id={rich_menu_id}")
        return rich_menu_id
    except Exception as e:
        session.rollback()
        error_msg = str(e).replace("\n", " ")
        line_logger.error(f"LINE_RICHMENU_DEFAULT_FAILED reason='{error_msg}'")
        return None


def sync_all_rich_menus(session: Session) -> dict:
    """設定預設選單並重新同步所有綁定帳號（改了 LINE 介面設定、部門設定、撿貨部門等批次變動後觸發），
    最後把沒有人在用的舊選單從 LINE 刪掉（LINE 每個頻道最多 1000 個圖文選單）。"""
    default_id = ensure_default_rich_menu(session)
    menu = menu_for(session)
    used = {UNBOUND_SIGNATURE}
    bindings = session.exec(select(UserLineBinding)).all()
    synced = 0
    for binding in bindings:
        user = session.get(User, binding.user_id)
        if user:
            sync_user_rich_menu(session, user, binding.line_user_id, menu=menu, used_signatures=used)
            synced += 1
    removed = _delete_unused_rich_menus(session, used)
    return {"default_rich_menu_id": default_id, "users": synced, "removed_menus": removed}


def _delete_unused_rich_menus(session: Session, used: set) -> int:
    if settings.LINE_SUPPRESS_SEND:
        return 0
    removed = 0
    try:
        with httpx.Client(timeout=15.0) as client:
            for cached in session.exec(select(LineRichMenu)).all():
                if cached.signature in used:
                    continue
                response = client.delete(f"{RICHMENU_URL}/{cached.rich_menu_id}", headers=_headers())
                if response.status_code not in (200, 404):
                    response.raise_for_status()
                session.delete(cached)
                session.commit()
                removed += 1
                line_logger.info(f"LINE_RICHMENU_DELETED signature={cached.signature} rich_menu_id={cached.rich_menu_id}")
    except Exception as e:
        session.rollback()
        error_msg = str(e).replace("\n", " ")
        line_logger.error(f"LINE_RICHMENU_CLEANUP_FAILED reason='{error_msg}'")
    return removed


def sync_users_in_background(bind, user_ids: list[int]) -> None:
    """給 BackgroundTasks 用：request 的 session 那時已關閉，用它的 bind（session.get_bind()）自己開一個。"""
    with Session(bind) as session:
        for user_id in user_ids:
            user = session.get(User, user_id)
            if user:
                sync_user_rich_menu(session, user)
