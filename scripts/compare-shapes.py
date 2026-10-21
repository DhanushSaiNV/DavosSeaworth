import math

def render_mark(cx, cy, r, stem_left, stem_right, arc_R, y_top_stem, y_bot_stem, width=88, height=88):
    dx = stem_left - cx
    dy = math.sqrt(arc_R**2 - dx**2)
    y_cut_top = cy - dy
    y_cut_bot = cy + dy
    r_top = (stem_right - stem_left) / 2.0
    x_center_top = stem_left + r_top
    y_center_top = y_top_stem + r_top

    grid = [[' ' for _ in range(width)] for _ in range(height)]
    
    for y in range(height):
        for x in range(width):
            # check circle
            if (x - cx)**2 + (y - cy)**2 <= r**2:
                grid[y][x] = 'O'
            
            # check stem
            in_stem = False
            # top semicircle
            if y < y_center_top:
                if (x - x_center_top)**2 + (y - y_center_top)**2 <= r_top**2:
                    in_stem = True
            elif y_center_top <= y <= y_bot_stem:
                if stem_left <= x <= stem_right:
                    # check if inside cutout
                    if y_cut_top <= y <= y_cut_bot:
                        if (x - cx)**2 + (y - cy)**2 < arc_R**2:
                            in_stem = False
                        else:
                            in_stem = True
                    else:
                        in_stem = True
            if in_stem:
                grid[y][x] = '#'
                
    return grid

def print_diff(g1, g2, name1, name2):
    print(f'=== {name1} vs {name2} ===')
    for y in range(0, 88, 3):
        row1 = ''.join(g1[y][x] for x in range(0, 88, 2))
        row2 = ''.join(g2[y][x] for x in range(0, 88, 2))
        print(f'{y:2d} |{row1}|  |{row2}|')

# Icon (scaled to 88x88 coordinate frame)
# In icon.svg: cx=41.5, cy=74.25, r=22, stem=64.5..88.5 (w=24), top=19.25, bot=95.25.
# Total width=69, height=77.
# In 88x88 with mark centered:
# ox = (88 - 69) / 2 = 9.5.
# oy = (88 - 77) / 2 = 5.5.
# cx_icon = 9.5 + 22 = 31.5. stem_left = 31.5 + 23 = 54.5. stem_right = 54.5 + 24 = 78.5.
# cy_icon = 5.5 + (77 - 22) = 60.5. y_top = 5.5. y_bot = 5.5 + 76 = 81.5.
g_icon = render_mark(cx=31.5, cy=60.5, r=22, stem_left=54.5, stem_right=78.5, arc_R=28, y_top_stem=5.5, y_bot_stem=81.5)

# Current icon-small
g_small_curr = render_mark(cx=28, cy=60.5, r=22, stem_left=56, stem_right=82, arc_R=31, y_top_stem=5.5, y_bot_stem=81.5)

# Candidate 1: cx=31, dx=25, gap=3.0, R=29.5
g_cand1 = render_mark(cx=31, cy=60.5, r=22, stem_left=56, stem_right=82, arc_R=29.5, y_top_stem=5.5, y_bot_stem=81.5)

# Candidate 2: cx=32, dx=24, gap=2.0, R=29.0
g_cand2 = render_mark(cx=32, cy=60.5, r=22, stem_left=56, stem_right=82, arc_R=29.0, y_top_stem=5.5, y_bot_stem=81.5)

# Candidate 3: cx=33, dx=23, gap=1.0, R=28.0 (exact gap match to icon.svg)
g_cand3 = render_mark(cx=33, cy=60.5, r=22, stem_left=56, stem_right=82, arc_R=28.0, y_top_stem=5.5, y_bot_stem=81.5)

print_diff(g_icon, g_cand1, "ICON.SVG", "CANDIDATE 1 (cx=31, gap=3.0, R=29.5)")
print_diff(g_icon, g_cand2, "ICON.SVG", "CANDIDATE 2 (cx=32, gap=2.0, R=29.0)")
print_diff(g_icon, g_cand3, "ICON.SVG", "CANDIDATE 3 (cx=33, gap=1.0, R=28.0)")

