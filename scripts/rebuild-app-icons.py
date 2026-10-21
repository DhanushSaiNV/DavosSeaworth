# scripts/rebuild-app-icons.py
# Regenerates app icons with corrected optical scaling and spacing.
from PIL import Image

NAVY = (15, 27, 45) # #0F1B2D

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

    # 2. Rebuild icon.png (1024x1024 RGB, no alpha channel)
    icon_1024 = Image.new('RGB', (1024, 1024), NAVY)
    ox = (1024 - TARGET_W) // 2
    oy = (1024 - TARGET_H) // 2
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

    # 5. Note on notification-icon.png:
    # assets/images/notification-icon.png is customly designed for Android notification
    # requirements (96x96 pure white silhouette on transparent background with optical
    # small-size spacing from icon-small-white.svg). Do not overwrite with the app icon.
    print('assets/images/notification-icon.png preserved (custom notification design)')

    # 6. Rebuild web/PWA assets
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
