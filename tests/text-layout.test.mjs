import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, fitTextAttributes, layoutLabelText } from '../dist/text-layout.js';

const width = text => [...text].length;

test('wrapText fits words and normalizes whitespace without dropping content', () => {
  const source = '  Panel\tA\nSlot   5  terminal  ';
  const lines = wrapText(source, 8, width);
  assert.deepEqual(lines, ['Panel A', 'Slot 5', 'terminal']);
  assert.equal(lines.join(' ').replaceAll(' ', ''), source.replace(/\s+/gu, ''));
  assert.equal(wrapText(' \n ', 8, width).length, 0);
});

test('wrapText splits unbroken text at grapheme boundaries', () => {
  const source = '👩🏽‍🔧e\u0301abcd';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemeWidth = text => [...segmenter.segment(text)].length;
  const lines = wrapText(source, 2, graphemeWidth);
  assert.deepEqual(lines, ['👩🏽‍🔧e\u0301', 'ab', 'cd']);
  assert.equal(lines.join(''), source);
  assert.ok(lines.every(line => graphemeWidth(line) <= 2));
});

test('wrapText keeps an indivisible character even when it exceeds the width', () => {
  assert.deepEqual(wrapText('A🙂B', 3, text => text.includes('🙂') ? text.length + 5 : text.length), ['A', '🙂', 'B']);
  assert.deepEqual(wrapText(' A  B ', 0, width), ['A B']);
});

test('fitTextAttributes applies only to overflowing text and positive finite widths', () => {
  assert.equal(fitTextAttributes('abcd', 3, width), ' textLength="3" lengthAdjust="spacingAndGlyphs"');
  assert.equal(fitTextAttributes('abc', 3, width), '');
  assert.equal(fitTextAttributes('abc', 4, width), '');
  assert.equal(fitTextAttributes('abc', 0, width), '');
  assert.equal(fitTextAttributes('abc', Infinity, width), '');
});

test('text width condenses or expands glyphs while keeping them inside the available width', () => {
  assert.equal(fitTextAttributes('abcd', 10, width, .5), ' textLength="2" lengthAdjust="spacingAndGlyphs"');
  assert.equal(fitTextAttributes('abcd', 10, width, 2), ' textLength="8" lengthAdjust="spacingAndGlyphs"');
  assert.equal(fitTextAttributes('abcd', 5, width, 2), ' textLength="5" lengthAdjust="spacingAndGlyphs"');
  assert.equal(fitTextAttributes('', 10, width, .5), '');
});

const measure = (text, size) => [...text].length * size;

test('explicit font sizes stay fixed, and condensation determines when names wrap', () => {
  const options = { fontSize: 10, horizontalPadding: 20, verticalPadding: 20 };
  const normal = layoutLabelText('ABCD EFGH', 100, 100, measure, options);
  const condensed = layoutLabelText('ABCD EFGH', 100, 100, measure, { ...options, textWidthPercent: 70 });
  assert.deepEqual(normal.lines, ['ABCD', 'EFGH']);
  assert.deepEqual(condensed.lines, ['ABCD EFGH']);
  assert.equal(condensed.fontSize, 10);
  assert.equal(condensed.widthScale, .7);
  assert.equal(layoutLabelText('ABCD EFGH', 100, 60, measure, { fontSize: 24 }).fontSize, 24);
});

test('auto text can shrink, while crowded labels retain every character without inserted spaces', () => {
  assert.equal(layoutLabelText('A', 210, 60, measure).fontSize, 15);
  const name = 'ABCDEFGHIJKLMNO';
  const automatic = layoutLabelText(name, 160, 60, measure);
  assert.equal(automatic.fontSize, 10);
  assert.equal(automatic.lines.join(''), name);
  assert.deepEqual(layoutLabelText(name, 160, 40, measure).lines, [name]);
  const explicit = layoutLabelText('ABCD EFGHIJKLMNO', 160, 100, measure, { fontSize: 24 });
  assert.equal(explicit.fontSize, 24);
  assert.equal(explicit.lines.join('').replaceAll(' ', ''), 'ABCDEFGHIJKLMNO');
  const unicode = '👩🏽‍🔧e\u0301abcd';
  assert.equal(layoutLabelText(unicode, 160, 60, measure).lines.join(''), unicode);
  assert.deepEqual(layoutLabelText('', 160, 60, measure).lines, []);
});
