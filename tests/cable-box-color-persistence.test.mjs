import test from 'node:test';
import assert from 'node:assert/strict';
import { CABLE_LABEL_COLORS } from '../dist/cable-colors.js';
import { createLabelClipboard, parseLabelClipboard, prepareLabelPaste, serializeLabelClipboard } from '../dist/label-clipboard.js';
import { FOUR_WIRE_ORDER_REVISION, geometry, normalizeProject } from '../dist/model.js';
import { MODULE_TYPES } from '../dist/modules.js';

const device = (extra = {}) => ({ id: 'device-1', kind: 'device', x: 40, y: 100, name: 'Valve', cable: '17',
  wireCount: 2, cableSide: 'left', wireSide: 'right', colors: { black: '#123456', white: '#ffffff' }, ...extra });
const module = (extra = {}) => ({ id: 'module-1', kind: 'module', type: 'AI', x: 500, y: 30,
  name: 'Analog input', slot: '5', rio: 'RIO A', ...extra });
const wire = () => ({ id: 'wire-1', from: 'device-1:black', to: 'module-1:ch0-minus', color: '#123456', width: 2.5 });
const source = (nodes = [device(), module()], wires = [wire()]) => ({ version: 1, title: 'Box colors',
  fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION, nodes, wires, settings: { grid: 10, snap: true, defaultWidth: 2.5 } });
const normalize = input => normalizeProject(input, MODULE_TYPES);
const savedAndReopened = value => normalize(JSON.parse(JSON.stringify(value)));

test('each palette box color survives save and reopen with canonical lowercase hex', () => {
  for (const color of CABLE_LABEL_COLORS) {
    const upper = color.toUpperCase();
    const original = source([device({ boxColor: upper }), module()]);
    const normalized = normalize(original);
    assert.equal(normalized.nodes[0].boxColor, color, upper);
    assert.equal(original.nodes[0].boxColor, upper, 'normalization does not mutate the source');
    assert.deepEqual(savedAndReopened(normalized), normalized);
  }
});

test('invalid box colors and box colors on other node kinds are omitted', () => {
  const invalid = [null, '', '#fff', '#123456', '#ffffff', '#E5393500', ' #e53935', '#e53935 ',
    'red', 'url(javascript:alert(1))', '<script>alert(1)</script>', 123456, true, {}, ['#e53935']];
  for (const boxColor of invalid) {
    const normalized = normalize(source([device({ boxColor }), module()]));
    assert.equal(Object.hasOwn(normalized.nodes[0], 'boxColor'), false, String(boxColor));
    assert.deepEqual(savedAndReopened(normalized), normalized);
  }
  const nodes = [device(), module({ boxColor: CABLE_LABEL_COLORS[0] }),
    { id: 'tag-1', kind: 'tag', x: 700, y: 100, name: 'NET1', boxColor: CABLE_LABEL_COLORS[1] },
    { id: 'label-1', kind: 'wire-label', x: 900, y: 100, name: 'lead', boxColor: CABLE_LABEL_COLORS[2] }];
  const normalized = normalize(source(nodes));
  for (const node of normalized.nodes) assert.equal(Object.hasOwn(node, 'boxColor'), false, node.kind);
});

test('legacy node shapes, conductor colors, wire data, and geometry stay unchanged', () => {
  const legacy = normalize(source());
  assert.equal(Object.hasOwn(legacy.nodes[0], 'boxColor'), false);
  assert.deepEqual(savedAndReopened(legacy), legacy);

  const colored = normalize(source([device({ boxColor: CABLE_LABEL_COLORS[3] }), module()]));
  const withoutBoxColor = structuredClone(colored);
  delete withoutBoxColor.nodes[0].boxColor;
  assert.deepEqual(withoutBoxColor, legacy);
  assert.deepEqual(colored.nodes[0].colors, legacy.nodes[0].colors);
  assert.deepEqual(colored.wires, legacy.wires);
  assert.deepEqual(geometry(colored.nodes, MODULE_TYPES), geometry(legacy.nodes, MODULE_TYPES));
});

test('clipboard copy, parse, and paste retain a device box color', () => {
  const original = normalize(source([device({ boxColor: CABLE_LABEL_COLORS[4] })], []));
  const clipboard = createLabelClipboard(original.nodes, new Set(['device-1']));
  assert.equal(clipboard.nodes[0].boxColor, CABLE_LABEL_COLORS[4]);
  const parsed = parseLabelClipboard(serializeLabelClipboard(clipboard));
  assert.deepEqual(parsed, clipboard);

  const destination = normalize(source([], []));
  const pasted = prepareLabelPaste(destination, parsed, MODULE_TYPES, { desired: { x: 800, y: 400 } });
  assert.equal(pasted.nodes.length, 1);
  assert.equal(pasted.nodes[0].boxColor, CABLE_LABEL_COLORS[4]);
  const reopened = savedAndReopened({ ...destination, nodes: pasted.nodes });
  assert.equal(reopened.nodes[0].boxColor, CABLE_LABEL_COLORS[4]);
  assert.equal(original.nodes[0].boxColor, CABLE_LABEL_COLORS[4]);
});
