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

/** Add SVG text fitting attributes only when the text exceeds its width. */
export function fitTextAttributes(text, maxWidth, measure) {
  return Number.isFinite(maxWidth) && maxWidth > 0 && measure(String(text ?? '')) > maxWidth
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
}
