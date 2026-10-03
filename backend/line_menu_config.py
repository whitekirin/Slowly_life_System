"""「LINE 介面設定」：圖文選單磚塊、聊天室按鈕卡、LIFF 首頁共用的外觀與排列。

功能本身與「誰看得到」在 line_actions.py 的註冊表（照系統權限，這裡不能改）；這裡只存管理員調的：
分組的名稱、副標、顏色、順序、開關，功能的名稱、所屬分組、順序、開關，以及「全部功能」磚塊的文字。
設定以 JSON 存在 SystemSetting(key="line_menu_config")，沒存過就是註冊表的預設值。
註冊表新增的分組或功能會自動補在最後；已經不存在的代碼讀取時直接略過。
"""
import json
from dataclasses import dataclass, replace
from typing import Any, Optional

from sqlmodel import Session

from backend.line_actions import LINE_ACTIONS, LINE_MENU_GROUPS, LineAction, LineMenuGroup
from backend.models import SystemSetting

SETTING_KEY = "line_menu_config"

# 慢生活色票。accent：白字放上面（≥4.5:1）、按鈕與強調；tint：淡底；ink：放在 tint 上的字（≥6.6:1）
PALETTE: dict[str, dict[str, str]] = {
    "brown": {"label": "品牌棕", "accent": "#8B6545", "tint": "#F1E6D6", "ink": "#5E4330"},
    "green": {"label": "墨綠", "accent": "#4F6B58", "tint": "#E6EEE6", "ink": "#3B5244"},
    "amber": {"label": "暖橘", "accent": "#9A6A2B", "tint": "#F7EAD3", "ink": "#6E4B22"},
    "brick": {"label": "磚紅", "accent": "#A4513F", "tint": "#F6E3DD", "ink": "#7E3B2F"},
    "slate": {"label": "霧藍", "accent": "#55697D", "tint": "#E3E9EF", "ink": "#3F5164"},
    "plum": {"label": "梅紫", "accent": "#785670", "tint": "#EFE4EC", "ink": "#5A3F54"},
    "olive": {"label": "橄欖", "accent": "#6B6A3A", "tint": "#EEEDDC", "ink": "#4E4D29"},
    "stone": {"label": "石灰", "accent": "#74685B", "tint": "#EEE9E2", "ink": "#544A40"},
}

# 磚塊寬 625px：標題超過 6 個字就會縮得很小，副標 14 字；按鈕文字是 LINE 的上限 20 字
GROUP_LABEL_MAX = 6
SUBTITLE_MAX = 14
ACTION_LABEL_MAX = 20

DEFAULT_ALL_TILE = {"label": "全部功能", "subtitle": "開啟操作首頁"}


def default_config() -> dict:
    return {
        "groups": [
            {"code": g.code, "label": g.label, "subtitle": g.subtitle, "color": g.color, "enabled": True}
            for g in LINE_MENU_GROUPS.values()
        ],
        "actions": [
            {"code": a.code, "label": a.label, "group": a.group, "enabled": True}
            for a in LINE_ACTIONS.values()
        ],
        "all_tile": dict(DEFAULT_ALL_TILE),
    }


def _text(value: Any, default: str, max_len: int, field: str, strict: bool, allow_empty: bool = False) -> str:
    """value 是 None（沒有這個欄位）就用預設值；allow_empty 的欄位只有明確給空字串才留空。"""
    if value is None:
        return default
    text = value.strip() if isinstance(value, str) else ""
    if not text and not allow_empty:
        if strict:
            raise ValueError(f"{field}不能空白")
        return default
    if len(text) > max_len:
        if strict:
            raise ValueError(f"{field}最多 {max_len} 個字（目前「{text}」）")
        text = text[:max_len]
    return text


def normalize_config(data: Any, strict: bool = False) -> dict:
    """把存的（或前端送來的）設定整理成完整的設定。strict=True 時遇到不合法的值丟 ValueError（存檔用），
    否則改用預設值（讀取用，避免舊資料讓 LINE 選單整個壞掉）。"""
    data = data if isinstance(data, dict) else {}
    defaults = default_config()
    default_groups = {g["code"]: g for g in defaults["groups"]}
    default_actions = {a["code"]: a for a in defaults["actions"]}

    groups, seen = [], set()
    for entry in data.get("groups") or []:
        code = entry.get("code") if isinstance(entry, dict) else None
        if code not in default_groups or code in seen:
            continue
        seen.add(code)
        base = default_groups[code]
        color = entry.get("color", base["color"])
        if color not in PALETTE:
            if strict:
                raise ValueError(f"分組「{base['label']}」的顏色不在色票裡")
            color = base["color"]
        groups.append({
            "code": code,
            "label": _text(entry.get("label"), base["label"], GROUP_LABEL_MAX, f"分組「{base['label']}」的名稱", strict),
            "subtitle": _text(entry.get("subtitle"), base["subtitle"], SUBTITLE_MAX, f"分組「{base['label']}」的副標", strict, allow_empty=True),
            "color": color,
            "enabled": bool(entry.get("enabled", True)),
        })
    groups += [dict(g) for code, g in default_groups.items() if code not in seen]

    actions, seen = [], set()
    for entry in data.get("actions") or []:
        code = entry.get("code") if isinstance(entry, dict) else None
        if code not in default_actions or code in seen:
            continue
        seen.add(code)
        base = default_actions[code]
        group = entry.get("group", base["group"])
        if group not in default_groups:
            if strict:
                raise ValueError(f"功能「{base['label']}」的分組不存在")
            group = base["group"]
        actions.append({
            "code": code,
            "label": _text(entry.get("label"), base["label"], ACTION_LABEL_MAX, f"功能「{base['label']}」的名稱", strict),
            "group": group,
            "enabled": bool(entry.get("enabled", True)),
        })
    actions += [dict(a) for code, a in default_actions.items() if code not in seen]

    all_tile = data.get("all_tile") if isinstance(data.get("all_tile"), dict) else {}
    return {
        "groups": groups,
        "actions": actions,
        "all_tile": {
            "label": _text(all_tile.get("label"), DEFAULT_ALL_TILE["label"], GROUP_LABEL_MAX, "「全部功能」磚塊的名稱", strict),
            "subtitle": _text(all_tile.get("subtitle"), DEFAULT_ALL_TILE["subtitle"], SUBTITLE_MAX, "「全部功能」磚塊的副標", strict, allow_empty=True),
        },
    }


def load_config(session: Session) -> dict:
    row = session.get(SystemSetting, SETTING_KEY)
    try:
        data = json.loads(row.value) if row else {}
    except (TypeError, ValueError):
        data = {}
    return normalize_config(data)


def save_config(session: Session, data: Any) -> dict:
    """驗證後存檔（不合法丟 ValueError）。呼叫端負責之後重新同步所有人的圖文選單。"""
    config = normalize_config(data, strict=True)
    row = session.get(SystemSetting, SETTING_KEY) or SystemSetting(key=SETTING_KEY, value="", description="LINE 介面設定（圖文選單、按鈕卡、LIFF 首頁）")
    row.value = json.dumps(config, ensure_ascii=False)
    session.add(row)
    session.commit()
    return config


def reset_config(session: Session) -> dict:
    row = session.get(SystemSetting, SETTING_KEY)
    if row:
        session.delete(row)
        session.commit()
    return default_config()


@dataclass(frozen=True)
class ResolvedMenu:
    groups: list[LineMenuGroup]  # 開啟的分組，依顯示順序，名稱／副標／顏色已套用設定
    actions: list[LineAction]  # 開啟且所屬分組也開啟的功能，依顯示順序，名稱／分組已套用設定
    all_tile: dict


def resolve_menu(config: dict) -> ResolvedMenu:
    groups = [
        LineMenuGroup(g["code"], g["label"], g["subtitle"], g["color"])
        for g in config["groups"] if g["enabled"]
    ]
    enabled_groups = {g.code for g in groups}
    actions = [
        replace(LINE_ACTIONS[a["code"]], label=a["label"], group=a["group"])
        for a in config["actions"]
        if a["enabled"] and a["group"] in enabled_groups
    ]
    return ResolvedMenu(groups=groups, actions=actions, all_tile=config["all_tile"])


def menu_for(session: Session) -> ResolvedMenu:
    return resolve_menu(load_config(session))


def palette_of(color: Optional[str]) -> dict[str, str]:
    return PALETTE.get(color or "", PALETTE["brown"])
