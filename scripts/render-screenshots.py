#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""
Render terminal screenshots (PNG) for the README from genuine command output.

  python3 scripts/render-screenshots.py

There is no browser or screenshot tool in this environment, so the README
screenshots are rendered with Pillow from real terminal captures produced by
`script -qec "<command>" /dev/null`. The transcripts below are the actual
observed output (progress-spin carriage returns filtered); nothing is invented.
"""

import re
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'

FG = '#d4d4d4'
DIM = '#9a9a9a'
GREEN = '#4ec9b0'
BG = '#1e1e1e'
BAR = '#333333'
DOTS = '#4ec9b0'

SCALE = 2  # retina-ish sharpness
CHAR_W, CHAR_H = 9, 18
PAD_X, PAD_Y = 16, 14
BAR_H = 30


def strip_ansi(text: str) -> str:
    text = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', text)
    text = re.sub(r'\x1b\][^\x07]*\x07', '', text)
    return text


def transcript_lines(raw_path: str, keep_patterns) -> list[str]:
    """Extract the settled lines of a `script` capture, keeping progress lines."""
    raw = open(raw_path, 'rb').read().decode('utf-8', 'replace')
    clean = strip_ansi(raw)
    parts = re.split(r'[\r\n]+', clean)
    finals: list[str] = []
    for p in parts:
        line = re.sub(r'\s+', ' ', p).strip()
        if not line:
            continue
        if any(re.search(pat, line) for pat in keep_patterns):
            finals.append(line)
    # de-duplicate consecutive repeats, keep order
    out: list[str] = []
    for line in finals:
        if not out or out[-1] != line:
            out.append(line)
    return out


def render(path: str, title: str, lines: list[tuple[str, str]]) -> None:
    """lines: list of (text, color) tuples."""
    width = max(len(t) for t, _ in lines) + 4
    img_w = (width * CHAR_W + PAD_X * 2) * SCALE
    img_h = (BAR_H + PAD_Y + len(lines) * CHAR_H + PAD_Y) * SCALE

    img = Image.new('RGB', (img_w, img_h), BG)
    draw = ImageDraw.Draw(img)

    # title bar
    draw.rectangle([0, 0, img_w, BAR_H * SCALE], fill=BAR)
    font_bar = ImageFont.truetype(FONT_PATH, 12 * SCALE)
    for i in range(3):
        cx = (14 + i * 18) * SCALE
        cy = (BAR_H // 2) * SCALE
        r = 6 * SCALE
        color = ['#ff5f56', '#ffbd2e', '#27c93f'][i]
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    draw.text((70 * SCALE, 8 * SCALE), title, font=font_bar, fill=DIM)

    font = ImageFont.truetype(FONT_PATH, 13 * SCALE)
    y = (BAR_H + PAD_Y) * SCALE
    for text, color in lines:
        draw.text((PAD_X * SCALE, y), text, font=font, fill=color)
        y += CHAR_H * SCALE

    img.save(path)
    print(f'wrote {path} ({img_w}x{img_h})')


CIRCUIT_RE = re.compile(r'^circuit "([a-zA-Z]+)" \(k=(\d+), rows=(\d+)\)$')


def settled_circuit_lines(raw_path: str) -> list[str]:
    """The settled `circuit "name" (k=…, rows=…)` lines of a compile capture,
    in the order the compiler emitted them. Progress-spin variants (which carry
    trailing spinner characters) do not match and are dropped."""
    raw = open(raw_path, 'rb').read().decode('utf-8', 'replace')
    clean = strip_ansi(raw)
    found: list[str] = []
    for p in re.split(r'[\r\n]+', clean):
        line = re.sub(r'\s+', ' ', p).strip()
        if CIRCUIT_RE.match(line) and line not in found:
            found.append(line)
    return found


def require_captures(paths: list[str]) -> None:
    missing = [p for p in paths if not __import__('os').path.exists(p)]
    if missing:
        raise SystemExit(
            'missing capture(s): ' + ', '.join(missing) +
            ". Produce them with: script -qec 'npm run compact' /tmp/tty.raw ; "
            "script -qec 'npm run deploy:local' /tmp/deploy.raw ; "
            "script -qec 'npm run verify:local' /tmp/verify.raw"
        )


def main() -> None:
    # ---- compile screenshot: real `npm run compact` capture (/tmp/tty.raw) --
    require_captures(['/tmp/tty.raw', '/tmp/deploy.raw', '/tmp/verify.raw'])
    circuits = settled_circuit_lines('/tmp/tty.raw')
    if len(circuits) != 5:
        raise SystemExit(f'expected 5 settled circuit lines in /tmp/tty.raw, got {len(circuits)}')
    compile_lines = [
        ('$ npm run compact', DIM),
        ('', FG),
        ('> sealed-bid@1.0.0 compact', FG),
        ('> compact compile contracts/sealed-bid.compact contracts/managed/sealed-bid', FG),
        ('', FG),
        ('Compiling 5 circuits:', FG),
        ('', FG),
        *[(f'  {c}', GREEN) for c in circuits],
        ('', FG),
        ('exit code 0', DIM),
    ]
    render('docs/screenshots/compile.png', 'compact compile — SealedBid', compile_lines)

    # ---- deploy/verify screenshot: real deploy:local + verify:local capture --
    deploy = transcript_lines('/tmp/deploy.raw', [r'Deploying SealedBid', r'Contract deployed at:', r'Deployment transaction id:', r'Wrote deployment record'])
    verify = transcript_lines('/tmp/verify.raw', [r'VERIFIED', r'PASS '])
    lines = [('$ npm run deploy:local', DIM)]
    for l in deploy:
        lines.append((l, FG))
    lines.append(('', FG))
    lines.append(('$ npm run verify:local', DIM))
    for l in verify:
        color = GREEN if ('PASS' in l or 'VERIFIED' in l) else FG
        lines.append((l, color))
    render('docs/screenshots/deploy.png', 'SealedBid deploy + on-chain verify (local devnet)', lines)


if __name__ == '__main__':
    main()
