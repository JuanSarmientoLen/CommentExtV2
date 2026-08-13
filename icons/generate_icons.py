from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = max(2, size // 16)
    radius = max(6, size // 5)
    draw.rounded_rectangle(
        (pad, pad, size - pad, size - pad),
        radius=radius,
        fill=(11, 18, 32, 255),
        outline=(31, 41, 55, 255),
        width=max(1, size // 64),
    )

    bubble = [
        (size * 0.27, size * 0.28),
        (size * 0.73, size * 0.28),
        (size * 0.73, size * 0.58),
        (size * 0.48, size * 0.58),
        (size * 0.40, size * 0.72),
        (size * 0.40, size * 0.58),
        (size * 0.27, size * 0.58),
    ]

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.polygon(bubble, outline=(34, 211, 238, 180), width=max(2, size // 16))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(1, size // 32)))
    img = Image.alpha_composite(img, glow)

    draw = ImageDraw.Draw(img)
    draw.polygon(bubble, outline=(56, 189, 248, 255), width=max(2, size // 18))

    dot_y = size * 0.44
    for x_ratio, color in (
        (0.41, (34, 211, 238, 255)),
        (0.50, (56, 189, 248, 255)),
        (0.59, (129, 140, 248, 255)),
    ):
        r = max(2, size // 24)
        x = size * x_ratio
        draw.ellipse((x - r, dot_y - r, x + r, dot_y + r), fill=color)

    return img


root = Path(__file__).resolve().parent
for px in (16, 32, 48, 96, 128):
    icon = draw_icon(px)
    icon.save(root / f"icon-{px}.png")
