# scripts/rebuild-app-icons.py
# Regenerates app icons with corrected optical scaling and spacing.
from PIL import Image
import math

NAVY = (15, 27, 45)      # #0F1B2D
WHITISH = (249, 249, 251) # #F9F9FB

def rebuild():
    # 1. Load adaptive-foreground for full color mark
    fg = Image.open('assets/images/adaptive-foreground.png')
    bbox = fg.getbbox()
    mark = fg.crop(bbox)
    orig_w, orig_h = mark.size

    # Target height on 1024x1024 canvas: 440px (~43% of frame, down from 574px / 56%)
    TARGET_H = 440
    TARGET_W = int(orig_w * (TARGET_H / orig_h))
    mark_1024 = mark.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
    ox = (1024 - TARGET_W) // 2
    oy = (1024 - TARGET_H) // 2

    # 2. Rebuild icon.png (primary dark: 1024x1024 RGB, no alpha channel)
    icon_1024 = Image.new('RGB', (1024, 1024), NAVY)
    icon_1024.paste(mark_1024, (ox, oy), mark_1024)
    icon_1024.save('assets/images/icon.png', 'PNG')
    print('Updated assets/images/icon.png')

    # 3. Rebuild adaptive-foreground.png (1024x1024 RGBA, transparent)
    adaptive_fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    adaptive_fg.paste(mark_1024, (ox, oy), mark_1024)
    adaptive_fg.save('assets/images/adaptive-foreground.png', 'PNG')
    print('Updated assets/images/adaptive-foreground.png')

    # 4. Rebuild adaptive-monochrome.png (1024x1024 RGBA)
    mono = Image.open('assets/images/adaptive-monochrome.png')
    mono_bbox = mono.getbbox()
    mono_mark = mono.crop(mono_bbox)
    mono_resized = mono_mark.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
    adaptive_mono = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    adaptive_mono.paste(mono_resized, (ox, oy), mono_resized)
    adaptive_mono.save('assets/images/adaptive-monochrome.png', 'PNG')
    print('Updated assets/images/adaptive-monochrome.png')

    # 5. Build second icon version (light: Whitish #F9F9FB background, Navy #0F1B2D stem, Amber #E2A63B circle)
    cx = ox + (41.5 - 19.5) * (TARGET_H / 77.0)
    cy = oy + (74.25 - 19.25) * (TARGET_H / 77.0)
    mark_light = Image.new('RGBA', (TARGET_W, TARGET_H), (0, 0, 0, 0))
    for my in range(TARGET_H):
        for mx in range(TARGET_W):
            r, g, b, a = mark_1024.getpixel((mx, my))
            if a == 0:
                continue
            gx, gy = ox + mx, oy + my
            d = math.hypot(gx - cx, gy - cy)
            if d < 140:
                mark_light.putpixel((mx, my), (r, g, b, a))
            else:
                mark_light.putpixel((mx, my), (NAVY[0], NAVY[1], NAVY[2], a))

    icon_light = Image.new('RGB', (1024, 1024), WHITISH)
    icon_light.paste(mark_light, (ox, oy), mark_light)
    icon_light.save('assets/images/icon-light.png', 'PNG')
    icon_light.save('assets/images/icon-2.png', 'PNG')
    print('Updated assets/images/icon-light.png and assets/images/icon-2.png')

    adaptive_fg_light = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    adaptive_fg_light.paste(mark_light, (ox, oy), mark_light)
    adaptive_fg_light.save('assets/images/adaptive-foreground-light.png', 'PNG')
    print('Updated assets/images/adaptive-foreground-light.png')

    # 6. Note on notification-icon.png:
    # assets/images/notification-icon.png is customly designed for Android notification
    # requirements (96x96 pure white silhouette on transparent background with optical
    # small-size spacing from icon-small-white.svg). Do not overwrite with the app icon.
    print('assets/images/notification-icon.png preserved (custom notification design)')

    # 7. Rebuild web/PWA assets
    # 512x512
    icon_512 = icon_1024.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save('public/android-chrome-512x512.png', 'PNG')
    icon_512.save('public/maskable-512.png', 'PNG')
    print('Updated 512x512 public icons')

    # 192x192
    icon_192 = icon_1024.resize((192, 192), Image.Resampling.LANCZOS)
    icon_192.save('public/android-chrome-192x192.png', 'PNG')
    print('Updated public/android-chrome-192x192.png')

    # 180x180 apple touch icon
    icon_180 = icon_1024.resize((180, 180), Image.Resampling.LANCZOS)
    icon_180.save('public/apple-touch-icon.png', 'PNG')
    print('Updated public/apple-touch-icon.png')

    # Favicons (48, 32, 16)
    icon_48 = icon_1024.resize((48, 48), Image.Resampling.LANCZOS)
    icon_48.save('assets/images/favicon.png', 'PNG')
    icon_48.save('public/favicon.png', 'PNG')
    icon_32 = icon_1024.resize((32, 32), Image.Resampling.LANCZOS)
    icon_32.save('public/favicon-32x32.png', 'PNG')
    icon_16 = icon_1024.resize((16, 16), Image.Resampling.LANCZOS)
    icon_16.save('public/favicon-16x16.png', 'PNG')
    icon_48.save('public/favicon.ico', format='ICO', sizes=[(48, 48), (32, 32), (16, 16)])
    print('Updated favicons')

if __name__ == '__main__':
    rebuild()
