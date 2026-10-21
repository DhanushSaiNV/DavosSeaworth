import math

def get_row(cx, cy, r, stem_left, stem_right, arc_R, y_top_stem, y_bot_stem, y, width=88):
    dx = stem_left - cx
    dy = math.sqrt(arc_R**2 - dx**2)
    y_cut_top = cy - dy
    y_cut_bot = cy + dy
    r_top = (stem_right - stem_left) / 2.0
    x_center_top = stem_left + r_top
    y_center_top = y_top_stem + r_top

    row = []
    for x in range(width):
        is_circle = (x - cx)**2 + (y - cy)**2 <= r**2
        is_stem = False
        if y < y_center_top:
            if (x - x_center_top)**2 + (y - y_center_top)**2 <= r_top**2:
                is_stem = True
        elif y_center_top <= y <= y_bot_stem:
            if stem_left <= x <= stem_right:
                if y_cut_top <= y <= y_cut_bot:
                    if (x - cx)**2 + (y - cy)**2 < arc_R**2:
                        is_stem = False
                    else:
                        is_stem = True
                else:
                    is_stem = True
        if is_circle:
            row.append('O')
        elif is_stem:
            row.append('#')
        else:
            row.append('.')
    return ''.join(row)

# Let's inspect the critical rows around the equator (y=50..70)
print('Row  | icon.svg (gap=1, R=28)                    | curr (cx=28, gap=6, R=31)           | cand1 (cx=31, gap=3, R=29.5)        | cand2 (cx=32, gap=2, R=29)          |')
for y in range(48, 72, 2):
    r_icon = get_row(31.5, 60.5, 22, 54.5, 78.5, 28, 5.5, 81.5, y)[15:68]
    r_curr = get_row(28, 60.5, 22, 56, 82, 31, 5.5, 81.5, y)[15:68]
    r_c1 = get_row(31, 60.5, 22, 56, 82, 29.5, 5.5, 81.5, y)[15:68]
    r_c2 = get_row(32, 60.5, 22, 56, 82, 29, 5.5, 81.5, y)[15:68]
    print(f'{y:2d}   | {r_icon} | {r_curr} | {r_c1} | {r_c2} |')
