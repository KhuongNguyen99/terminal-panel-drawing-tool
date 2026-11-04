"""Regenerate the DQ and AI RTD SVGs from the checked-in reference crops."""

import os
from pathlib import Path
from html import escape
from PIL import Image, ImageDraw
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import fitz

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'dist/assets'
OUTPUT = ROOT / 'build/asset-previews'
FONT_PATH = Path(os.environ.get(
    'WIREBENCH_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
)).expanduser()
if not FONT_PATH.is_file():
    raise SystemExit(
        f'Font not found: {FONT_PATH}\n'
        'Set WIREBENCH_FONT to a local DejaVuSans.ttf file. '
        'See tools/assets/README.md for setup instructions.'
    )
try:
    FONT = TTFont(FONT_PATH)
except Exception as exc:
    raise SystemExit(f'Unable to open font {FONT_PATH}: {exc}') from exc
OUTPUT.mkdir(exist_ok=True, parents=True)
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPEM = FONT['head'].unitsPerEm


def text_paths(value, x, baseline, size, width, color='#454545'):
    """Readable source wording, outlined so exports have no font dependency."""
    advances = [FONT['hmtx'].metrics[CMAP[ord(c)]][0] for c in value]
    sx = width / sum(advances)
    sy = size / UPEM
    result = [f'<g aria-label="{escape(value)}" fill="{color}" transform="translate({x} {baseline}) scale({sx:.8f} {-sy:.8f})">']
    cursor = 0
    for char, advance in zip(value, advances):
        pen = SVGPathPen(GLYPHS)
        GLYPHS[CMAP[ord(char)]].draw(pen)
        path = pen.getCommands()
        if path:
            result.append(f'<path d="{path}" transform="translate({cursor} 0)"/>')
        cursor += advance
    result.append('</g>')
    return ''.join(result)


def source_detail_trace(source, bounds, exclude_rows=()):
    """Keep tiny illegible edge markings as exact source-pixel vector runs.

    These are only narrow embossed-number strips. All large shapes and legible
    labels are explicit geometry; no full-asset raster is embedded.
    """
    image = Image.open(source).convert('RGBA')
    x0, y0, x1, y1 = bounds
    runs = []
    for y in range(y0, y1):
        if y in exclude_rows:
            continue
        x = x0
        while x < x1:
            rgba = image.getpixel((x, y))
            r, g, b, a = rgba
            # Only retain neutral, dark molded marks. Exclude colored arrows,
            # background, highlights and external annotation borders.
            if a and max(r, g, b) - min(r, g, b) < 8 and 35 < r < 105:
                start = x
                while x + 1 < x1 and image.getpixel((x + 1, y)) == rgba:
                    x += 1
                runs.append(f'<path d="M{start} {y}h{x - start + 1}v1h-{x - start + 1}Z" fill="rgb({r},{g},{b})"/>')
            x += 1
    return '<g aria-label="Original small molded markings, source-pixel traces">' + ''.join(runs) + '</g>'


def build(kind):
    dq = kind == 'dq'
    source_width = 88 if dq else 83
    left = 23 if dq else 18
    right = 86 if dq else 81
    face = '#737373' if dq else '#757575'
    edge = '#5c5c5c' if dq else '#5d5d5d'
    front = left + 3.5
    cover_right = right - 4
    circle_left, circle_right = (45, 64) if dq else (40.5, 59)
    rows = [312, 330, 349, 368, 387, 406, 425, 444, 463] if dq else [311, 330, 348, 367, 386, 405, 424, 443, 462]
    title = 'DQ 8x24VDC/0.5A HF — 6ES7132-6BF00-0CA0' if dq else 'AI 4xRTD/TC HF — 6ES7134-6JD00-0CA1'
    channel_note = '' if dq else ' RTD terminals use CH0/CH2 on the left and CH1/CH3 on the right; each channel has M+, M-, I+ and I- connections.'
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{source_width * 4}" height="1944" viewBox="0 0 {source_width} 486" role="img" aria-label="{title}">',
           f'<title>{title}</title>',
           f'<desc>Precise front-view reconstruction from the supplied module reference. Geometry, visible wording, indicator layout, terminal rows and colors follow that reference. Small unreadable molded edge marks retain their original pixel outlines.{channel_note}</desc>']
    # Rear housing tongue and its subdued outer lip.
    svg += [f'<path d="M{left - 15.5} 30H{left + 1}V97H{left - 15.5}Z" fill="{face}" stroke="{edge}" stroke-width="1"/>',
            f'<path d="M{left - 16.5} 30V97" fill="none" stroke="#969696" stroke-width=".8"/>',
            f'<path d="M{left - 19} 250L{left - 7} 241V251H{left + 1}V262H{left - 19}Z" fill="{face}" stroke="{edge}" stroke-width=".85"/>']
    # Three visible side lugs beside the terminal assembly.
    for y in ([356, 378, 406] if dq else [354, 377, 405]):
        svg.append(f'<path d="M.5 {y}H{left + 1}V{y + 16}H.5Z" fill="{face}" stroke="{edge}" stroke-width=".65"/>')
    # Body profile with upper beveled rim and bottom seam.
    svg += [f'<path d="M{left + 1} 5H{right - .5}V298H{left}V10Z" fill="{face}" stroke="{edge}" stroke-width="1"/>',
            f'<path d="M{left + 1} 5H{right - .5}V17H{left}V10Z" fill="#5d5d5d"/>',
            f'<path d="M{left + 1} 5H{right - .5}" fill="none" stroke="#939393" stroke-width="1"/>',
            f'<path d="M{left + 2} 10H{right - 4}" fill="none" stroke="#454545" stroke-width="1"/>',
            f'<path d="M{left + .3} 18V289" fill="none" stroke="#929292" stroke-width=".55"/>',
            f'<path d="M{right - .7} 17V290" fill="none" stroke="#4f4f4f" stroke-width=".7"/>']
    tab_x = 47 if dq else 41.5
    svg += [f'<path d="M{tab_x - 4} 10V7H{tab_x + 18}V10" fill="none" stroke="#444444" stroke-width=".9"/>',
            f'<path d="M{tab_x} 1H{tab_x + 14.5}V10H{tab_x}Z" fill="{face}" stroke="{edge}" stroke-width=".7"/>']
    svg += [text_paths('DQ' if dq else 'AI', front, 26, 10.6, 13 if dq else 9),
            text_paths('HF', right - 14, 26, 10, 10.2),
            text_paths('8x24VDC/0.5A' if dq else '4xRTD/TC', front, 37, 10, 54.7 if dq else 41.5)]
    svg += [f'<path d="M{left} 40H{right}V48H{left}Z" fill="#7b7b7b" stroke="#606060" stroke-width=".75"/>',
            f'<path d="M{left + 1} 41H{right - 1}" stroke="#929292" stroke-width=".5"/>',
            f'<rect x="{front}" y="42" width="4.5" height="4.5" fill="#fafafa" stroke="#969696" stroke-width=".65"/>',
            text_paths('DIAG', front, 55.3, 8.4, 15.2)]
    # Recessed removable label cover with characteristic inset shoulders.
    svg += [f'<path d="M{front} 60.5H{cover_right}V73.5L{cover_right - 3} 76.2V178.2L{cover_right} 181.3V194.5H{front}V181.3L{front + 3.2} 178.2V76.2L{front} 73.5Z" fill="{face}" stroke="{edge}" stroke-width="1.15"/>',
            f'<path d="M{front} 60.5H{cover_right}V66.7H{front}Z" fill="#5d5d5d" stroke="#505050" stroke-width=".65"/>',
            f'<path d="M{front + 1} 67.5V73L{front + 4} 76V178.5L{front + 1} 181.7V193.8" fill="none" stroke="#898989" stroke-width=".5"/>']
    # Channel and fault LED groups. All labels are transcribed from the source.
    labels = [('.0', '.1'), ('F0', 'F1'), ('.2', '.3'), ('F2', 'F3'), ('.4', '.5'), ('F4', 'F5'), ('.6', '.7'), ('F6', 'F7')] if dq else [('AI0', 'AI1'), ('F0', 'F1'), ('AI2', 'AI3'), ('F2', 'F3')]
    first_y = 203 if dq else 202
    right_led = front + 17
    for row, pair in enumerate(labels):
        y = first_y + row * 8.2
        for x, label in [(front, pair[0]), (right_led, pair[1])]:
            svg.append(f'<rect x="{x}" y="{y}" width="4.9" height="4.9" fill="#f8f8f8" stroke="#909090" stroke-width=".8"/>')
            svg.append(text_paths(label, x + 6, y + 5.1, 8.3, 8.5 if len(label) == 3 else 7.5))
    block_x = 64 if dq else 58
    block_y = 203 if dq else 202
    svg.append(f'<rect x="{block_x}" y="{block_y}" width="18.6" height="18.5" fill="{("#000000" if dq else "#4b6eff")}" stroke="#5b5b5b" stroke-width="1"/>')
    svg += [f'<rect x="{front}" y="267" width="4.9" height="4.9" fill="#f8f8f8" stroke="#909090" stroke-width=".8"/>',
            text_paths('PWR', front + 5.8, 272.3, 8, 13.2),
            text_paths('CC02' if dq else 'CC00', right - 18, 272.3, 7.5, 14.5),
            text_paths('6ES7132-6BF00-0CA0' if dq else '6ES7134-6JD00-0CA1', front, 287.2, 8.4, 55),
            f'<path d="M{left} 291H{right}V298H{left}Z" fill="#303030"/>',
            f'<path d="M{left} 290.5H{right}" stroke="#666666" stroke-width="1"/>']
    # BaseUnit face, footer and the upper latch bridging the seam.
    svg += [f'<path d="M{left} 298H{right}V483H{left}Z" fill="{face}" stroke="{edge}" stroke-width=".85"/>',
            f'<path d="M{left + 1} 298V482" stroke="#8b8b8b" stroke-width=".65"/>',
            f'<path d="M{right - 1} 298V482" stroke="#5a5a5a" stroke-width=".7"/>']
    for index, cy in enumerate(rows):
        for column, cx in enumerate([circle_left, circle_right]):
            terminal_label = ''
            if not dq and index < 8:
                signal = ['M+', 'M+', 'M-', 'M-', 'I+', 'I+', 'I-', 'I-'][index]
                terminal_label = f' aria-label="CH{index % 2 * 2 + column} {signal}"'
            svg.append(f'<circle cx="{cx}" cy="{cy}" r="8.55" fill="{face}" stroke="#585858" stroke-width=".85"{terminal_label}/>')
            svg.append(f'<path d="M{cx - 7.8} {cy + 2.7}A8.3 8.3 0 0 0 {cx + 6.7} {cy + 4.8}" fill="none" stroke="#808080" stroke-width=".35"/>')
        for side in ['left', 'right']:
            slot_x = left + 3 if side == 'left' else right - 11
            face_x = slot_x + 2
            button_x = left + 4 if side == 'left' else right - 3
            # Gray terminal housings with dark upper releases, white lower
            # releases, and the original red/blue power releases at the foot.
            svg.append(f'<path d="M{slot_x} {cy - 8.7}H{slot_x + 8.2}V{cy + 8.7}H{slot_x}Z" fill="#656565" stroke="#505050" stroke-width=".8"/>')
            fill = '#4f4f4f' if index < 4 else ('#f5f5f5' if index < 8 else ('#f50000' if side == 'left' else '#0707ee'))
            svg.append(f'<path d="M{face_x} {cy - 7.6}H{face_x + 4.1}V{cy + 7.6}H{face_x}Z" fill="{fill}"/>')
            svg.append(f'<path d="M{slot_x + 1} {cy - 8}V{cy + 8}" stroke="#414141" stroke-width="1"/>')
            svg.append(f'<circle cx="{button_x}" cy="{cy + .2}" r="2.1" fill="{face}" stroke="#555555" stroke-width=".6"/>')
            svg.append(f'<path d="M{button_x - 1.6} {cy - 7}V{cy - 3.6}M{button_x - 1.6} {cy + 3.5}V{cy + 7}" stroke="#666666" stroke-width=".7"/>')
        # The three circular molding recesses between terminal column pairs.
        if index in [0, 2, 4, 7]:
            mid = (circle_left + circle_right) / 2
            svg.append(f'<circle cx="{mid}" cy="{cy + 9.5}" r="2.45" fill="{face}" stroke="#606060" stroke-width=".75"/>')
    svg += [f'<path d="M{tab_x} 297H{tab_x + 14.5}V306H{tab_x}Z" fill="{face}" stroke="#555555" stroke-width=".8"/>',
            f'<path d="M{tab_x + .5} 297H{tab_x + 14}" stroke="#909090" stroke-width=".7"/>',
            f'<path d="M{left + 4} 482V477H{left + 10}V474H{left + .8}M{right - 4} 482V477H{right - 10}V474H{right - .8}" fill="none" stroke="#595959" stroke-width=".85"/>',
            f'<path d="M{left + 1} 482H{right - 1}" stroke="#8a8a8a" stroke-width=".6"/>']
    # Only the very narrow, illegible edge-number strip is traced. This keeps
    # uncertain tiny markings instead of inventing channel or terminal labels.
    svg.append(source_detail_trace(ASSETS / f'module-{kind}.png', (right - 1, 305, min(right + 1, source_width), 471), range(375, 380) if dq else ()))
    svg.append('</svg>')
    path = ASSETS / f'module-{kind}.svg'
    path.write_text('\n'.join(svg), encoding='utf-8', newline='\n')
    doc = fitz.open(stream=path.read_bytes(), filetype='svg')
    pix = doc[0].get_pixmap(alpha=True)
    rendered = OUTPUT / f'module-{kind}-vector.png'
    pix.save(rendered)
    original = Image.open(ASSETS / f'module-{kind}.png').convert('RGBA').resize((source_width * 4, 1944), Image.Resampling.NEAREST)
    rebuilt = Image.open(rendered).convert('RGBA')
    # MuPDF treats CSS px as 0.75pt; render at the declared SVG pixel dimensions.
    if rebuilt.size != original.size:
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(4/3, 4/3), alpha=True)
        pix.save(rendered)
        rebuilt = Image.open(rendered).convert('RGBA')
    margin = 26
    compare = Image.new('RGB', (source_width * 8 + margin * 3, 1988), '#fafafa')
    draw = ImageDraw.Draw(compare)
    draw.text((margin, 8), 'SOURCE (nearest pixel)', fill='#202020')
    draw.text((source_width * 4 + margin * 2, 8), 'VECTOR RECONSTRUCTION', fill='#202020')
    compare.paste(original, (margin, 35), original)
    compare.paste(rebuilt, (source_width * 4 + margin * 2, 35), rebuilt)
    compare.save(OUTPUT / f'module-{kind}-comparison.png')
    print(path, path.stat().st_size, 'bytes', 'rendered', rebuilt.size)


build('dq')
build('ai-rtd')
