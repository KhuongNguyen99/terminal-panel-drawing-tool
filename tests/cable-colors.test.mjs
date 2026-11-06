import test from 'node:test';
import assert from 'node:assert/strict';
import { CABLE_LABEL_COLORS, cableLabelColor } from '../dist/cable-colors.js';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, RTD_CHANNEL_LAYOUT_REVISION, geometry, normalizeProject } from '../dist/model.js';
import { createLabelClipboard, serializeLabelClipboard, parseLabelClipboard } from '../dist/label-clipboard.js';

test('matching cable numbers share a color, including whitespace and case variations', () => {
  assert.equal(cableLabelColor(' 17 '), cableLabelColor('17'));
  assert.equal(cableLabelColor(17), cableLabelColor('17'));
  assert.equal(cableLabelColor(' cable-A '), cableLabelColor('CABLE-a'));
  for (const value of ['', ' \t\n ', null, undefined]) assert.equal(cableLabelColor(value), null);
});

test('the six primary/secondary cable colors repeat deterministically', () => {
  assert.equal(CABLE_LABEL_COLORS.length, 6);
  assert.equal(new Set(CABLE_LABEL_COLORS).size, 6);
  const first = Array.from({ length: 6 }, (_, i) => cableLabelColor(String(i + 1)));
  assert.equal(new Set(first).size, 6, 'consecutive cable groups cycle through all six colors');
  for (let i = 1; i <= 500; i++) assert.ok(CABLE_LABEL_COLORS.includes(cableLabelColor(`CABLE-${i}`)));
  assert.ok(Object.isFrozen(CABLE_LABEL_COLORS));
});

test('cable colors survive save and copy without changing conductor colors or geometry', () => {
  const nodes = ['one', 'two'].map((id, i) => ({ id, kind: 'device', name: id, cable: 'C-17',
    wireCount: i ? 4 : 2, x: i * 400, y: 0, colors: { black: '#123456', white: '#ffffff' } }));
  const project = normalizeProject({ version: 1, nodes, wires: [], fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
    rtdChannelLayoutRevision: RTD_CHANNEL_LAYOUT_REVISION }, MODULE_TYPES);
  const before = structuredClone(project), beforeGeometry = geometry(project.nodes, MODULE_TYPES);
  const reopened = normalizeProject(JSON.parse(JSON.stringify(project)), MODULE_TYPES);
  const clipboard = parseLabelClipboard(serializeLabelClipboard(createLabelClipboard(project.nodes, ['one', 'two'])));
  for (const n of [...reopened.nodes, ...clipboard.nodes]) {
    assert.equal(cableLabelColor(n.cable), cableLabelColor('C-17'));
    assert.equal(n.colors.black, '#123456');
    assert.equal(n.colors.white, '#ffffff');
  }
  assert.deepEqual(project, before);
  assert.deepEqual(geometry(project.nodes, MODULE_TYPES), beforeGeometry);
});
