"""Contrast ratios for every text/background pair in a Fred palette file.

    python3 -I .claude/skills/ux-ui-review/contrast.py apps/mobile/src/theme.tsx

Reads the `day` and `night` palettes (name: '#RRGGBB' entries) and prints the
WCAG 2.2 contrast ratio for the pairs Fred actually draws text on, flagging
anything under 4.5:1 (text) and under 7:1 for safety text.
"""
import re
import sys

# (text colour, background, what it is, needs) — needs is 'text', 'safety' or 'large'.
PAIRS = [
    ('ink', 'cream', 'body text on the page', 'safety'),
    ('ink', 'paper', 'body text on a card / the text box', 'safety'),
    ('ink', 'sage', "the hiker's question bubble", 'text'),
    ('ink', 'blush', "a Don't block", 'safety'),
    ('warn', 'blush', "bold words in a Don't block", 'safety'),
    ('moss', 'cream', 'secondary text: sources, hints', 'text'),
    ('moss', 'paper', 'secondary text on a card', 'text'),
    ('moss', 'oat', 'secondary text on a chip', 'text'),
    ('pine', 'cream', 'links, headings, titles', 'text'),
    ('pine', 'sage', 'step numbers', 'text'),
    ('plum', 'cream', 'the medical disclaimer', 'safety'),
    ('clay', 'cream', 'errors, stopped notes', 'text'),
    ('amber', 'butter', 'location notes', 'text'),
    ('ink', 'oat', 'chip labels', 'text'),
    ('paper', 'pine', 'primary button label', 'text'),
    ('paper', 'clay', 'stop button / destructive', 'text'),
]
NEEDS = {'text': 4.5, 'large': 3.0, 'safety': 7.0}


def lum(hex_colour: str) -> float:
    h = hex_colour.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def palettes(src: str) -> dict:
    out = {}
    for name in ('day', 'night'):
        m = re.search(r'export const ' + name + r': Palette = \{(.*?)\};', src, re.S)
        if m:
            out[name] = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", m.group(1)))
    return out


def main() -> None:
    src = open(sys.argv[1] if len(sys.argv) > 1 else 'apps/mobile/src/theme.tsx').read()
    worst = 0
    for name, p in palettes(src).items():
        print(f'== {name}')
        for fg, bg, what, need in PAIRS:
            if fg not in p or bg not in p:
                continue
            r = ratio(p[fg], p[bg])
            target = NEEDS[need]
            flag = 'ok' if r >= target else ('LOW' if r < 4.5 else 'under 7:1')
            if r < 4.5:
                worst += 1
            print(f'  {r:5.1f}:1  {flag:9}  {fg} on {bg}: {what}')
    sys.exit(1 if worst else 0)


if __name__ == '__main__':
    main()
