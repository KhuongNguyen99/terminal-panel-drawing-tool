import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, RTD_CHANNEL_LAYOUT_REVISION, boundsOf, geometry,
  labelFontSize, labelTextWidthPercent, normalizeProject } from '../dist/model.js';
import { createLabelClipboard, parseLabelClipboard, prepareLabelPaste, serializeLabelClipboard } from '../dist/label-clipboard.js';

const source = () => ({
  version: 1, title: 'Typography', fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
  rtdChannelLayoutRevision: RTD_CHANNEL_LAYOUT_REVISION,
  nodes: [
    { id: 'device', kind: 'device', name: 'Cable', x: 40, y: 100, width: 220, height: 70,
      cable: 'C-1', wireCount: 2, wireSide: 'right', colors: {} },
    { id: 'inline', kind: 'wire-label', name: 'Return', x: 320, y: 100, width: 230, height: 60, color: '#234567' },
    { id: 'tag', kind: 'tag', name: 'NET1', x: 650, y: 200, width: 180, height: 44, wireSide: 'left' },
    { id: 'module', kind: 'module', type: 'AI', name: 'Analog input', x: 900, y: 100, slot: '1', rio: 'A' },
  ],
  wires: [
    { id: 'cable-wire', from: 'device:black', to: 'module:ch0-minus', color: '#202631', width: 2.5 },
    { id: 'label-wire', from: 'inline:right', to: 'tag:connector', color: '#234567', width: 2.5 },
  ],
  settings: { grid: 10, snap: true, defaultWidth: 2.5 },
});
const normalize = project => normalizeProject(project, MODULE_TYPES);
const typography = node => ({ fontSize: node.fontSize, textWidthPercent: node.textWidthPercent });

test('typography helpers accept only bounded integer values and use auto/default for invalid inputs', () => {
  for (const value of [6, 72, '6', '72']) assert.equal(labelFontSize({ fontSize: value }), Number(value));
  for (const value of [undefined, null, '', ' ', 5, 73, 24.5, '7.5', NaN, Infinity, false, [], {}, '1e3']) {
    assert.equal(labelFontSize({ fontSize: value }), undefined, `fontSize ${String(value)}`);
  }
  assert.equal(labelFontSize(), undefined);
  for (const value of [25, 100, 200, '25', '100', '200']) assert.equal(labelTextWidthPercent({ textWidthPercent: value }), Number(value));
  for (const value of [undefined, null, '', ' ', 24, 201, 99.5, '99.5', NaN, Infinity, true, [], {}, '1e3']) {
    assert.equal(labelTextWidthPercent({ textWidthPercent: value }), 100, `textWidthPercent ${String(value)}`);
  }
  assert.equal(labelTextWidthPercent(), 100);
});

test('normalization preserves typography on all label kinds and keeps legacy and module shapes', () => {
  const legacy = normalize(source());
  for (const node of legacy.nodes) {
    assert.equal(Object.hasOwn(node, 'fontSize'), false);
    assert.equal(Object.hasOwn(node, 'textWidthPercent'), false);
  }
  const styledInput = source();
  Object.assign(styledInput.nodes[0], { fontSize: '6', textWidthPercent: '25' });
  Object.assign(styledInput.nodes[1], { fontSize: 72, textWidthPercent: 200 });
  Object.assign(styledInput.nodes[2], { fontSize: 36, textWidthPercent: 100 });
  Object.assign(styledInput.nodes[3], { fontSize: 48, textWidthPercent: 50 });
  const styled = normalize(styledInput);
  assert.deepEqual(styled.nodes.slice(0, 3).map(typography), [
    { fontSize: 6, textWidthPercent: 25 },
    { fontSize: 72, textWidthPercent: 200 },
    { fontSize: 36, textWidthPercent: 100 },
  ]);
  assert.equal(Object.hasOwn(styled.nodes[3], 'fontSize'), false);
  assert.equal(Object.hasOwn(styled.nodes[3], 'textWidthPercent'), false);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(styled))), styled, 'save and reopen retain explicit values, including 100%');
  const stripped = structuredClone(styled);
  for (const node of stripped.nodes) { delete node.fontSize; delete node.textWidthPercent; }
  assert.deepEqual(stripped, legacy, 'typography adds appearance metadata only');
  assert.deepEqual(geometry(styled.nodes, MODULE_TYPES), geometry(legacy.nodes, MODULE_TYPES));
  assert.deepEqual(boundsOf(styled.nodes, MODULE_TYPES), boundsOf(legacy.nodes, MODULE_TYPES));
});

test('invalid imports restore auto size and 100% width without changing label geometry or wires', () => {
  const baseline = normalize(source());
  const input = source();
  for (const node of input.nodes.slice(0, 3)) Object.assign(node, { fontSize: 73, textWidthPercent: 24 });
  const invalid = normalize(input);
  for (const node of invalid.nodes.slice(0, 3)) {
    assert.equal(Object.hasOwn(node, 'fontSize'), false);
    assert.equal(node.textWidthPercent, 100);
  }
  assert.deepEqual(invalid.wires, baseline.wires);
  assert.deepEqual(geometry(invalid.nodes, MODULE_TYPES), geometry(baseline.nodes, MODULE_TYPES));
  assert.deepEqual(boundsOf(invalid.nodes, MODULE_TYPES), boundsOf(baseline.nodes, MODULE_TYPES));
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(invalid))), invalid);
});

test('copy and paste retain typography for device, wire label, and tag without copying wires', () => {
  const input = source();
  Object.assign(input.nodes[0], { fontSize: 6, textWidthPercent: 25 });
  Object.assign(input.nodes[1], { fontSize: 72, textWidthPercent: 200 });
  Object.assign(input.nodes[2], { fontSize: 24, textWidthPercent: 100 });
  const original = normalize(input);
  const beforeCopy = structuredClone(original);
  const copied = createLabelClipboard(original.nodes, original.nodes.map(node => node.id));
  assert.deepEqual(copied.nodes.map(node => node.kind), ['device', 'wire-label', 'tag']);
  assert.deepEqual(copied.nodes.map(typography), original.nodes.slice(0, 3).map(typography));
  assert.equal(Object.hasOwn(copied, 'wires'), false);
  const transferred = parseLabelClipboard(serializeLabelClipboard(copied));
  assert.deepEqual(transferred, copied);
  const destination = normalize({ ...source(), nodes: [], wires: [] });
  const pasted = prepareLabelPaste(destination, transferred, MODULE_TYPES, { desired: { x: 1000, y: 1000 } });
  assert.deepEqual(pasted.nodes.map(typography), copied.nodes.map(typography));
  for (let index = 0; index < pasted.nodes.length; index++) {
    const { id: oldId, x: oldX, y: oldY, ...originalFields } = copied.nodes[index];
    const { id: newId, x: newX, y: newY, ...pastedFields } = pasted.nodes[index];
    assert.notEqual(newId, oldId);
    assert.deepEqual(pastedFields, originalFields);
  }
  assert.deepEqual(normalize({ ...destination, nodes: pasted.nodes }).nodes, pasted.nodes);
  assert.deepEqual(destination.wires, []);
  assert.deepEqual(original, beforeCopy, 'copy and paste leave source nodes and connections intact');
});
