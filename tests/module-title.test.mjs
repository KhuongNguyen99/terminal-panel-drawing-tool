import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, RTD_CHANNEL_LAYOUT_REVISION, normalizeProject,
  moduleTitleFontSize, moduleHeader, geometry, boundsOf } from '../dist/model.js';

const module = (type, extra = {}) => ({ id: `module-${type}`, kind: 'module', type,
  name: MODULE_TYPES[type].label, x: 400, y: 200, rio: 'RIO A', slot: '5', ...extra });
const project = nodes => ({ version: 1, nodes, wires: [], fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
  rtdChannelLayoutRevision: RTD_CHANNEL_LAYOUT_REVISION });
const normalize = nodes => normalizeProject(project(nodes), MODULE_TYPES);

test('module title sizes validate bounded integers and leave old project shapes intact', () => {
  for (const value of [6, 13, 32, 72, '24']) assert.equal(moduleTitleFontSize({ titleFontSize: value }), Number(value));
  for (const value of [undefined, null, '', ' ', 5, 73, 24.5, 'bad', true, [], {}, NaN, Infinity]) {
    assert.equal(moduleTitleFontSize({ titleFontSize: value }), undefined);
    const n = normalize([module('AI', { titleFontSize: value })]).nodes[0];
    assert.equal(Object.hasOwn(n, 'titleFontSize'), false);
  }
  const legacy = normalize([module('AI')]);
  assert.equal(Object.hasOwn(legacy.nodes[0], 'titleFontSize'), false);
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(legacy)), MODULE_TYPES), legacy);
});

test('saved title styles survive reopen on every module without becoming label typography', () => {
  const nodes = Object.keys(MODULE_TYPES).map(type => module(type, { titleFontSize: '32', fontSize: 24 }));
  nodes.push({ id: 'device', kind: 'device', name: 'Device', x: 0, y: 0, titleFontSize: 32, fontSize: 18 });
  const first = normalize(nodes);
  for (const n of first.nodes.filter(n => n.kind === 'module')) {
    assert.equal(n.titleFontSize, 32);
    assert.equal(Object.hasOwn(n, 'fontSize'), false);
  }
  assert.equal(first.nodes.at(-1).fontSize, 18);
  assert.equal(Object.hasOwn(first.nodes.at(-1), 'titleFontSize'), false);
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(first)), MODULE_TYPES), first);
});

test('large titles grow upward and update routing/export bounds without moving hardware or connectors', () => {
  for (const [type, template] of Object.entries(MODULE_TYPES)) {
    const plain = module(type), styled = module(type, { titleFontSize: 72 });
    const originalTemplate = structuredClone(template);
    const base = moduleHeader(plain, template), header = moduleHeader(styled, template);
    assert.equal(header.x, base.x);
    assert.equal(header.width, base.width);
    assert.equal(header.y + header.height, base.y + base.height, 'bottom edge stays above the hardware');
    assert.ok(header.height >= 72 * 1.2 + 12);
    const before = geometry([plain], MODULE_TYPES), after = geometry([styled], MODULE_TYPES);
    assert.deepEqual(after.ports, before.ports, `${type}: connector IDs and endpoints do not move`);
    assert.deepEqual(after.obstacles.find(o => o.id === styled.id), before.obstacles.find(o => o.id === plain.id));
    const title = after.obstacles.find(o => o.y === styled.y + header.y);
    assert.ok(title, `${type}: routing sees the enlarged title`);
    assert.deepEqual([title.x, title.y, title.width, title.height],
      [styled.x + header.x, styled.y + header.y, header.width, header.height]);
    if (template.routingObstacles) assert.notEqual(title.nodeId, styled.id, 'DIN title remains an independent routing obstacle');
    const bounds = boundsOf([styled], MODULE_TYPES);
    assert.ok(bounds.y < title.y && bounds.y + bounds.height > styled.y + template.height);
    assert.deepEqual(template, originalTemplate, 'shared templates stay unchanged');
  }
});

test('restoring the default title style restores original module geometry and bounds', () => {
  for (const type of Object.keys(MODULE_TYPES)) {
    const plain = module(type), restored = module(type, { titleFontSize: 48 });
    delete restored.titleFontSize;
    assert.deepEqual(geometry([restored], MODULE_TYPES), geometry([plain], MODULE_TYPES));
    assert.deepEqual(boundsOf([restored], MODULE_TYPES), boundsOf([plain], MODULE_TYPES));
  }
});
