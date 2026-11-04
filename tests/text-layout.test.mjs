import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, fitTextAttributes } from '../dist/text-layout.js';

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
