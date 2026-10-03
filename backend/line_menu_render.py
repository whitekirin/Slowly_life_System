"""畫 LINE 圖文選單的圖（慢生活風格）。文字與顏色來自「LINE 介面設定」，所以在伺服器上即時畫，
不再用事先產生好的 PNG。需要 Noto CJK 字型（Dockerfile 裝 fonts-noto-cjk）。

磚塊 625×843（LINE 圖文選單寬 2500 = 4 欄）：米白底上一張紙卡，上方是分組名稱第一個字的圓章，
下面依序是名稱（襯線粗體）、副標、一條分組主色的短線。「全部功能」是品牌棕底的反白卡。
"""
import io
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from backend.line_actions import LineMenuGroup
from backend.line_menu_config import palette_of

TILE_W, TILE_H = 625, 843
COLUMNS = 4

FONT_DIRS = [Path("/usr/share/fonts/opentype/noto"), Path("/usr/share/fonts/noto-cjk")]
SANS_BOLD = "NotoSansCJK-Bold.ttc"
SANS_REGULAR = "NotoSansCJK-Regular.ttc"
SERIF_BOLD = "NotoSerifCJK-Bold.ttc"

# docs/design-system-slowlife.md
BG = "#F5EFE6"
SURFACE = "#FFFDF8"
BORDER = "#E3D9CB"
TEXT = "#3E352D"
TEXT_SECONDARY = "#66594C"
BRAND = "#8B6545"
BRAND_LIGHT_TEXT = "#FAF3E8"  # 品牌棕底上的副標（4.7:1）


@lru_cache(maxsize=64)
def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    """Noto CJK 的 .ttc 裡有 JP/KR/SC/TC/HK 好幾套，挑繁中（TC）那套。"""
    for directory in FONT_DIRS:
        path = directory / name
        if not path.exists():
            continue
        for index in range(10):
            try:
                font = ImageFont.truetype(str(path), size, index=index)
            except OSError:
                break
            if "TC" in " ".join(font.getname()):
                return font
        return ImageFont.truetype(str(path), size)
    raise RuntimeError(f"找不到字型 {name}（需要安裝 fonts-noto-cjk）")


def _fit(draw: ImageDraw.ImageDraw, text: str, name: str, size: int, max_width: int, min_size: int) -> ImageFont.FreeTypeFont:
    while size > min_size:
        font = _font(name, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 4
    return _font(name, min_size)


def _center_text(draw: ImageDraw.ImageDraw, cx: float, cy: float, text: str, font, fill: str) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (right - left) / 2 - left, cy - (bottom - top) / 2 - top), text, font=font, fill=fill)


def _grid_icon(draw: ImageDraw.ImageDraw, cx: int, cy: int, fill: str) -> None:
    """「全部功能」的 3×3 方格圖示。"""
    cell, gap = 34, 18
    start = -(cell * 3 + gap * 2) / 2
    for row in range(3):
        for col in range(3):
            x = cx + start + col * (cell + gap)
            y = cy + start + row * (cell + gap)
            draw.rounded_rectangle((x, y, x + cell, y + cell), radius=9, fill=fill)


def draw_tile(image: Image.Image, x: int, y: int, label: str, subtitle: str, color: str, is_all: bool = False) -> None:
    draw = ImageDraw.Draw(image)
    card = (x + 22, y + 22, x + TILE_W - 22, y + TILE_H - 22)
    cx = x + TILE_W / 2
    text_width = TILE_W - 120

    if is_all:
        draw.rounded_rectangle(card, radius=48, fill=BRAND)
        draw.ellipse((cx - 112, y + 196, cx + 112, y + 420), fill="#9C7656")
        _grid_icon(draw, int(cx), y + 308, SURFACE)
        title_fill, subtitle_fill = SURFACE, BRAND_LIGHT_TEXT
    else:
        colors = palette_of(color)
        draw.rounded_rectangle(card, radius=48, fill=SURFACE, outline=BORDER, width=3)
        draw.ellipse((cx - 112, y + 196, cx + 112, y + 420), fill=colors["tint"])
        _center_text(draw, cx, y + 300, label[:1], _font(SERIF_BOLD, 132), colors["ink"])
        bar_y = y + TILE_H - 150
        draw.rounded_rectangle((cx - 56, bar_y, cx + 56, bar_y + 12), radius=6, fill=colors["accent"])
        title_fill, subtitle_fill = TEXT, TEXT_SECONDARY

    _center_text(draw, cx, y + 500, label, _fit(draw, label, SERIF_BOLD, 92, text_width, 56), title_fill)
    if subtitle:
        _center_text(draw, cx, y + 590, subtitle, _fit(draw, subtitle, SANS_REGULAR, 40, text_width, 28), subtitle_fill)


def _png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_rich_menu(groups: list[LineMenuGroup], all_tile: dict) -> tuple[bytes, int]:
    """分組磚塊＋最後一格「全部功能」，一列 4 格、最多兩列，空位只留底色。回傳 (PNG, 列數)。"""
    tiles = len(groups) + 1
    rows = 1 if tiles <= COLUMNS else 2
    image = Image.new("RGB", (TILE_W * COLUMNS, TILE_H * rows), BG)
    for i, group in enumerate(groups[: COLUMNS * rows - 1]):
        draw_tile(image, (i % COLUMNS) * TILE_W, (i // COLUMNS) * TILE_H, group.label, group.subtitle, group.color)
    i = min(len(groups), COLUMNS * rows - 1)
    draw_tile(image, (i % COLUMNS) * TILE_W, (i // COLUMNS) * TILE_H, all_tile["label"], all_tile["subtitle"], "brown", is_all=True)
    return _png(image), rows


def render_unbound() -> bytes:
    """還沒綁定系統帳號的人看到的選單（整片一個按鈕）。"""
    width, height = TILE_W * COLUMNS, TILE_H
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((22, 22, width - 22, height - 22), radius=48, fill=SURFACE, outline=BORDER, width=3)
    cx = width / 2
    _center_text(draw, cx, 250, "尚未綁定系統帳號", _font(SERIF_BOLD, 112), TEXT)
    _center_text(draw, cx, 390, "登入員工系統後，到「個人設定」綁定 LINE，就能在這裡使用你的功能", _font(SANS_REGULAR, 46), TEXT_SECONDARY)
    pill_w, pill_h, pill_y = 720, 128, 520
    draw.rounded_rectangle((cx - pill_w / 2, pill_y, cx + pill_w / 2, pill_y + pill_h), radius=pill_h / 2, fill=BRAND)
    _center_text(draw, cx, pill_y + pill_h / 2, "查看綁定方式", _font(SANS_BOLD, 54), SURFACE)
    return _png(image)
