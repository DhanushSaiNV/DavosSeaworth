import math

# Candidate 1: cx=31, dx=25, gap=3.0, R=29.5
# Candidate 2: cx=32, dx=24, gap=2.0, R=29.0
# Candidate 3: cx=33, dx=23, gap=1.0, R=28.0

def make_svg(cx, R, dx, dy_round=1):
    dy = math.sqrt(R**2 - dx**2)
    y1 = round(60.5 + dy, dy_round)
    y2 = round(60.5 - dy, dy_round)
    path = f"M56 18.5A13 13 0 0 1 82 18.5L82 81.5L56 81.5L56 {y1}A{R} {R} 0 0 0 56 {y2}L56 18.5Z"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" width="88" height="88">
  <g><circle cx="{cx}" cy="60.5" r="22" fill="#E2A63B"/><path d="{path}" fill="#0F1B2D" fill-rule="nonzero"/></g>
</svg>'''

print("cx=31:")
print(make_svg(31, 29.5, 25))

print("cx=32:")
print(make_svg(32, 29, 24))

print("cx=33:")
print(make_svg(33, 28, 23, 2))
