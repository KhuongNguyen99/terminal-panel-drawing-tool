const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

const graphemes = text => graphemeSegmenter
  ? Array.from(graphemeSegmenter.segment(text), part => part.segment)
  : Array.from(text);

/** Wrap SVG text using a caller-provided width measurement in SVG units. */
export function wrapText(text, maxWidth, measure) {
  const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [normalized];

  const lines = [];
  let line = '';
  for (const word of normalized.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (measure(word) <= maxWidth) { line = word; continue; }

    for (const character of graphemes(word)) {
      const joined = line + character;
      if (line && measure(joined) > maxWidth) { lines.push(line); line = character; }
      else line = joined;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fit SVG text to its width, applying optional glyph condensation or expansion. */
export function fitTextAttributes(text, maxWidth, measure, widthScale = 1) {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return '';
  const naturalWidth = measure(String(text ?? ''));
  const width = Math.min(maxWidth, naturalWidth * widthScale);
  return naturalWidth > 0 && width !== naturalWidth
    ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : '';
}

/** Explicit font sizes stay fixed; automatic text shrinks to fit the box. */
export function layoutLabelText(name, width, height, measure, {
  fontSize: requestedSize, textWidthPercent = 100, horizontalPadding = 82, verticalPadding = 34,
} = {}) {
  const availableWidth = width - horizontalPadding, availableHeight = height - verticalPadding;
  const normalized = String(name ?? '').replace(/\s+/gu, ' ').trim();
  const widthScale = textWidthPercent / 100;
  const minimumSize = requestedSize ?? 10;
  let fontSize = requestedSize ?? 15, lines, lineHeight, maxLines;
  for (;;) {
    lineHeight = fontSize + 3;
    maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    lines = wrapText(normalized, availableWidth, text => measure(text, fontSize) * widthScale);
    if (lines.length <= maxLines || fontSize === minimumSize) break;
    fontSize--;
  }
  if (lines.length > maxLines) {
    let remainder = normalized;
    for (const line of lines.slice(0, maxLines - 1)) remainder = remainder.slice(line.length).trimStart();
    lines = [...lines.slice(0, maxLines - 1), remainder];
  }
  return { lines, fontSize, lineHeight, availableWidth, widthScale,
    startY: 10 + availableHeight / 2 - (lines.length - 1) * lineHeight / 2 + fontSize * .35 };
}
