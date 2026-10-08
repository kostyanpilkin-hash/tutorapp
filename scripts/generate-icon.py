"""Generate TutorApp icon: white graduation cap on indigo->violet gradient."""
from PIL import Image, ImageDraw, ImageFilter
import os

SIZE = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 1024.0

    # Rounded-square gradient background
    radius = int(220 * s)
    grad = Image.new("RGB", (size, size))
    gd = ImageDraw.Draw(grad)
    c1, c2 = (79, 70, 229), (139, 92, 246)  # indigo-600 -> violet-500
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(c1, c2, y / size))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    white = (255, 255, 255, 255)

    # Mortarboard: a diamond (top-down square) slightly above center
    cx, cy = size * 0.5, size * 0.40
    bw, bh = size * 0.62, size * 0.30  # board width/height
    board = [
        (cx, cy - bh / 2),          # top
        (cx + bw / 2, cy),          # right
        (cx, cy + bh / 2),          # bottom
        (cx - bw / 2, cy),          # left
    ]
    d.polygon(board, fill=white)

    # Cap head part: trapezoid hanging below the board center
    head_top_w = size * 0.30
    head_bottom_w = size * 0.22
    head_top_y = cy + bh * 0.28
    head_bottom_y = cy + size * 0.30
    head = [
        (cx - head_top_w / 2, head_top_y),
        (cx + head_top_w / 2, head_top_y),
        (cx + head_bottom_w / 2, head_bottom_y),
        (cx - head_bottom_w / 2, head_bottom_y),
    ]
    d.polygon(head, fill=white)

    # Tassel: line from right tip of board down + button
    tx = cx + bw / 2 - size * 0.02
    ty0 = cy
    ty1 = cy + size * 0.26
    tassel_w = max(2, int(size * 0.016))
    d.line([(tx, ty0), (tx, ty1)], fill=white, width=tassel_w)
    r = size * 0.035
    d.ellipse([tx - r, ty1 - r, tx + r, ty1 + r], fill=white)

    # Small accent dot on board center (button where cap meets board)
    br = size * 0.022
    d.ellipse([cx - br, cy - br, cx + br, cy + br], fill=white)

    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    icon = make_icon(SIZE)
    icon.save(os.path.join(OUT, "icon.png"))

    # PNG sizes required by tauri.conf.json / Windows installer
    for name, px in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        icon.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name))

    # Multi-resolution .ico
    ico = make_icon(256)
    ico.save(
        os.path.join(OUT, "icon.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # .icns — Pillow writes icns on any platform
    try:
        make_icon(1024).save(os.path.join(OUT, "icon.icns"), format="ICNS")
    except Exception as e:
        print(f"icns skipped: {e}")

    print("Icons generated in", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
