import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, geometry, normalizeProject, deviceWidth, deviceHeight, tagWidth, tagHeight } from '../dist/model.js';
import { routeWithPreferences } from '../dist/independent-routing.js';
import { createLabelClipboard, serializeLabelClipboard, parseLabelClipboard, labelClipboardBounds, prepareLabelPaste } from '../dist/label-clipboard.js';

const device = (extra = {}) => ({ id: 'device', kind: 'device', name: '*v-3501#-y-pos', cable: '17', x: 100.25, y: 200.5,
  wireCount: 4, cableSide: 'right', wireSide: 'left', width: 320, height: 90,
  colors: { red: '#e54b4b', black: '#202631', white: '#eeddcc', green: '#123456' }, ...extra });
const tag = (extra = {}) => ({ id: 'tag', kind: 'tag', name: 'MOTOR_RUN', x: 500.75, y: 150.5, wireSide: 'top', width: 125, height: 35, ...extra });
const wireLabel = (extra = {}) => ({ id: 'inline', kind: 'wire-label', name: 'FLOW_RETURN', x: 900.25, y: 100.5, width: 300, height: 80, color: '#2a5f89', ...extra });
const module = (extra = {}) => ({ id: 'module', kind: 'module', type: 'AI', name: 'AI', rio: 'RIO A', slot: '5', x: 0, y: 0, ...extra });
const project = (nodes = [], wires = [], settings = {}) => normalizeProject({ version: 1, title: 'Paste destination',
  fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION, nodes, wires, settings: { grid: 10, snap: true, autoRoute: false, ...settings } }, MODULE_TYPES);
const fragment = (nodes = [device(), tag()]) => createLabelClipboard(nodes, new Set(nodes.map(node => node.id)));
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const body = node => ({ x: node.x, y: node.y,
  width: node.kind === 'tag' ? tagWidth(node) : deviceWidth(node), height: node.kind === 'tag' ? tagHeight(node) : deviceHeight(node) });
const separate = (a, b, margin) => a.x + a.width + margin < b.x || a.x - margin > b.x + b.width ||
  a.y + a.height + margin < b.y || a.y - margin > b.y + b.height;

test('copy keeps only selected labels, preserves their editable properties, and strips source assignments', () => {
  const nodes = [device({ assignment: { moduleId: 'module', channel: 0, tag: 'rioa.slot5.ai0' }, scheduleId: 'source', extra: 'discard' }),
    tag({ name: '', assignment: { moduleId: 'module' }, scheduleId: 'source' }), module(), tag({ id: 'unselected' })];
  const before = copy(nodes);
  freeze(nodes);
  const copied = createLabelClipboard(nodes, new Set(['device', 'tag', 'module']));
  assert.equal(copied.format, 'wirebench-labels');
  assert.equal(copied.version, 1);
  assert.deepEqual(copied.nodes.map(node => node.kind), ['device', 'tag']);
  assert.deepEqual(copied.nodes[0], device());
  assert.deepEqual(copied.nodes[1], tag({ name: '' }));
  assert.deepEqual(Object.keys(copied).sort(), ['format', 'nodes', 'version']);
  for (const node of copied.nodes) {
    assert.equal(Object.hasOwn(node, 'assignment'), false);
    assert.equal(Object.hasOwn(node, 'scheduleId'), false);
  }
  assert.deepEqual(nodes, before);
  assert.equal(createLabelClipboard(nodes, ['module']), null);
  assert.equal(createLabelClipboard(nodes, []), null);
  const reopened = parseLabelClipboard(serializeLabelClipboard(copied));
  assert.deepEqual(reopened, copied);
  reopened.nodes[0].colors.white = '#ffffff';
  assert.equal(copied.nodes[0].colors.white, '#eeddcc', 'clipboard content is an independent snapshot');
});

test('clipboard parsing rejects malformed or oversized input and sanitizes recognized labels', () => {
  const valid = fragment([tag()]);
  const malformed = [null, '', 'plain clipboard text', '{', 'x'.repeat(512 * 1024 + 1),
    JSON.stringify({ ...valid, format: 'other-app' }), JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, nodes: [] }), JSON.stringify({ ...valid, nodes: [module()] }),
    JSON.stringify({ ...valid, nodes: [null] }), JSON.stringify({ ...valid, nodes: [tag({ x: 999999 })] }),
    JSON.stringify({ ...valid, nodes: [tag({ y: '100' })] }), JSON.stringify({ ...valid, nodes: [tag({ id: '__bad:id' })] }),
    JSON.stringify({ ...valid, nodes: [tag(), tag()] }),
    JSON.stringify({ ...valid, nodes: Array.from({ length: 501 }, (_, i) => tag({ id: `tag-${i}` })) })];
  for (const text of malformed) assert.equal(parseLabelClipboard(text), null);
  const parsed = parseLabelClipboard(JSON.stringify({ format: 'wirebench-labels', version: 1, wires: [{ id: 'ignored' }], nodes: [
    device({ name: 'X'.repeat(150), width: -50, height: 5000, colors: { green: 'url(bad)', white: '#abcdef' }, assignment: { moduleId: 'module', channel: 0 } }),
    tag({ name: '  ', width: '300.6', height: false, arbitrary: 'discard' }),
  ] }));
  assert.ok(parsed);
  assert.equal(parsed.nodes[0].name.length, 120);
  assert.deepEqual([parsed.nodes[0].width, parsed.nodes[0].height], [1, 600]);
  assert.equal(parsed.nodes[0].colors.white, '#abcdef', 'four-wire colors are not migrated again');
  assert.equal(parsed.nodes[0].colors.green, '#2b9b68');
  assert.deepEqual([parsed.nodes[1].name, parsed.nodes[1].width, parsed.nodes[1].height], ['', 301, 40]);
  assert.equal(Object.hasOwn(parsed, 'wires'), false);
  assert.equal(Object.hasOwn(parsed.nodes[1], 'arbitrary'), false);
  assert.throws(() => serializeLabelClipboard({}), /valid WireBench/);
});

test('clipboard bounds use actual custom label sizes without export padding', () => {
  assert.deepEqual(labelClipboardBounds(fragment()), { x: 100.25, y: 150.5, width: 525.5, height: 140 });
  assert.deepEqual(labelClipboardBounds(fragment([tag({ width: undefined, height: undefined })])), { x: 500.75, y: 150.5, width: 160, height: 40 });
});

test('paste works across projects, snaps only the group origin, and leaves source data unchanged', () => {
  const copied = parseLabelClipboard(serializeLabelClipboard(fragment()));
  const target = project(), before = copy({ copied, target });
  freeze(copied); freeze(target);
  const pasted = prepareLabelPaste(target, copied, MODULE_TYPES, { desired: { x: 1003, y: 2007 } });
  assert.deepEqual(pasted.bounds, { x: 1000, y: 2010, width: 525.5, height: 140 });
  assert.deepEqual(pasted.nodes.map(node => [node.x, node.y]), [[1000, 2060], [1400.5, 2010]]);
  assert.equal(pasted.nodes[1].x - pasted.nodes[0].x, copied.nodes[1].x - copied.nodes[0].x);
  assert.equal(pasted.nodes[1].y - pasted.nodes[0].y, copied.nodes[1].y - copied.nodes[0].y);
  for (let i = 0; i < copied.nodes.length; i++) {
    const { id: sourceId, x: sourceX, y: sourceY, ...source } = copied.nodes[i];
    const { id: newId, x, y, ...destination } = pasted.nodes[i];
    assert.notEqual(newId, sourceId);
    assert.deepEqual(destination, source);
  }
  assert.equal(new Set(pasted.nodes.map(node => node.id)).size, 2);
  assert.deepEqual({ copied, target }, before);
  const restored = project(pasted.nodes);
  assert.deepEqual(restored.nodes, pasted.nodes);
  assert.equal(restored.wires.length, 0);
  const withoutSnap = prepareLabelPaste(project([], [], { snap: false }), copied, MODULE_TYPES, { desired: { x: 1003.25, y: 2007.75 } });
  assert.deepEqual([withoutSnap.bounds.x, withoutSnap.bounds.y], [1003.25, 2007.75]);
  assert.equal(withoutSnap.nodes[1].x - withoutSnap.nodes[0].x, 400.5);
});

test('paste avoids existing nodes and visible fixed wires without changing their routes', () => {
  const target = project([device({ wireCount: 2, width: 210, height: 60, wireSide: 'right', x: -400, y: 300 }), module()],
    [{ id: 'fixed', from: 'device:black', to: 'module:ch0-minus', color: '#202631', width: 4 }]);
  const baseline = routeWithPreferences({ ...geometry(target.nodes, MODULE_TYPES), wires: target.wires });
  target.wires[0].manual = copy(baseline.savedRoutes.fixed);
  target.wires[0].savedRoute = copy(baseline.savedRoutes.fixed);
  const copied = fragment([tag({ x: 0, y: 0, width: 240, height: 80 }), tag({ id: 'tag2', x: 0, y: 160, width: 100, height: 40 })]);
  const before = copy({ target, baseline, copied });
  freeze(target); freeze(baseline); freeze(copied);
  const pasted = prepareLabelPaste(target, copied, MODULE_TYPES, { desired: { x: -140, y: 300 }, routes: baseline });
  const { obstacles } = geometry(target.nodes, MODULE_TYPES);
  for (const node of pasted.nodes) {
    for (const obstacle of obstacles) assert.ok(separate(body(node), obstacle, 20));
    const points = baseline.routes.fixed.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      assert.ok(separate(body(node), { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, 10));
    }
  }
  const after = routeWithPreferences({ ...geometry([...target.nodes, ...pasted.nodes], MODULE_TYPES), wires: target.wires, autoRoute: false, preserveRoutes: true });
  assert.deepEqual(after.routes.fixed.points, baseline.routes.fixed.points);
  assert.notEqual(after.routes.fixed.status, 'blocked');
  assert.deepEqual(copy({ target, baseline, copied }), before);
});

test('placement preserves group gaps and clears visible blocked wire paths', () => {
  const copied = fragment([tag({ x: 0, y: 0, width: 160, height: 40 }), tag({ id: 'tag2', x: 0, y: 200, width: 160, height: 40 })]);
  const target = project([tag({ id: 'existing', x: 0, y: 100, width: 160, height: 40 })]);
  const routes = { visible: { status: 'blocked', points: [{ x: -200, y: 80 }, { x: 400, y: 80 }] } };
  const pasted = prepareLabelPaste(target, copied, MODULE_TYPES, { desired: { x: 0, y: 0 }, routes });
  assert.deepEqual([pasted.bounds.x, pasted.bounds.y], [0, 0], 'the space between copied labels need not be empty');
  const shifted = prepareLabelPaste(project(), fragment([tag({ x: 0, y: 0, width: 160, height: 40 })]), MODULE_TYPES,
    { desired: { x: 0, y: 60 }, routes });
  assert.ok(shifted.bounds.y + shifted.bounds.height + 10 < 80 || shifted.bounds.y - 10 > 80, 'blocked but visible paths retain their clearance');
});

test('large pasted labels can clear their source while new IDs remain collision-safe', () => {
  const originalNow = Date.now, originalRandom = Math.random;
  try {
    Date.now = () => 123456789;
    Math.random = () => 0.25;
    const collisionId = `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const target = project([tag({ id: collisionId, x: 0, y: 0, width: 1000, height: 600 })]);
    const copied = fragment(target.nodes);
    const first = prepareLabelPaste(target, copied, MODULE_TYPES, { desired: { x: 0, y: 0 } });
    assert.ok(separate(body(first.nodes[0]), body(target.nodes[0]), 20));
    assert.notEqual(first.nodes[0].id, collisionId);
    const nextProject = { ...target, nodes: [...target.nodes, ...first.nodes] };
    const second = prepareLabelPaste(nextProject, copied, MODULE_TYPES, { desired: { x: 2000, y: 2000 } });
    assert.equal(new Set([...nextProject.nodes, ...second.nodes].map(node => node.id)).size, 3);
  } finally { Date.now = originalNow; Math.random = originalRandom; }
});

test('paste limits and placement errors are atomic and explain how to recover', () => {
  const copied = fragment([tag({ x: 0, y: 0 })]);
  const target = project(Array.from({ length: 499 }, (_, i) => tag({ id: `existing-${i}`, x: 5000, y: 5000 })));
  const allowed = prepareLabelPaste(target, copied, MODULE_TYPES, { desired: { x: 0, y: 0 } });
  const full = { ...target, nodes: [...target.nodes, ...allowed.nodes] }, before = copy(full);
  freeze(full);
  assert.throws(() => prepareLabelPaste(full, copied, MODULE_TYPES, { desired: { x: 1000, y: 1000 } }), /500 items/);
  assert.deepEqual(full, before);
  assert.throws(() => prepareLabelPaste(project(), {}, MODULE_TYPES, { desired: { x: 0, y: 0 } }), /valid WireBench/);
  assert.throws(() => prepareLabelPaste(project(), copied, MODULE_TYPES, { desired: { x: Infinity, y: 0 } }), /valid canvas position/);
  const coverTypes = { COVER: { routingObstacles: [{ x: -2000, y: -2000, width: 4000, height: 4000 }], ports: [] } };
  const crowded = { nodes: [{ id: 'cover', kind: 'module', type: 'COVER', x: 0, y: 0 }], wires: [], settings: { grid: 10, snap: true } };
  const crowdedBefore = copy(crowded);
  freeze(crowded);
  assert.throws(() => prepareLabelPaste(crowded, copied, coverTypes, { desired: { x: 0, y: 0 } }), /Pan to an open area or copy fewer labels/);
  assert.deepEqual(crowded, crowdedBefore);
});

test('copy and paste preserve name-only wire labels without adding cable metadata or wires', () => {
  const original = wireLabel({ assignment: { moduleId: 'module', channel: 2 }, scheduleId: 'old-row', cable: '17',
    wireCount: 4, wireSide: 'top', colors: { green: '#2b9b68' }, extra: 'discard' });
  const nodes = [device(), original, tag(), module()], before = copy(nodes);
  freeze(nodes);
  const copied = createLabelClipboard(nodes, ['device', 'inline', 'tag', 'module']);
  assert.deepEqual(copied.nodes.map(node => node.kind), ['device', 'wire-label', 'tag']);
  assert.deepEqual(copied.nodes[1], wireLabel());
  assert.deepEqual(parseLabelClipboard(serializeLabelClipboard(copied)), copied);
  assert.equal(Object.hasOwn(copied, 'wires'), false);
  const pasted = prepareLabelPaste(project(), copied, MODULE_TYPES, { desired: { x: 1000, y: 1000 } });
  const label = pasted.nodes.find(node => node.kind === 'wire-label');
  assert.match(label.id, /^label-/);
  assert.notEqual(label.id, original.id);
  assert.deepEqual([label.name, label.width, label.height, label.color], ['FLOW_RETURN', 300, 80, '#2a5f89']);
  for (const key of ['assignment', 'scheduleId', 'cable', 'wireCount', 'wireSide', 'colors', 'extra']) assert.equal(Object.hasOwn(label, key), false);
  assert.equal(label.x - pasted.nodes[0].x, original.x - nodes[0].x, 'mixed-label groups keep their relative layout');
  const reopened = project(pasted.nodes);
  assert.deepEqual(reopened.nodes, pasted.nodes);
  assert.equal(reopened.wires.length, 0);
  const ports = geometry(reopened.nodes, MODULE_TYPES).ports;
  assert.deepEqual(Object.keys(ports).filter(id => id.startsWith(`${label.id}:`)), [`${label.id}:left`, `${label.id}:right`]);
  assert.deepEqual(nodes, before);
});

test('wire-label clipboard data uses the model name, color, and size sanitizers', () => {
  const parsed = parseLabelClipboard(JSON.stringify({ format: 'wirebench-labels', version: 1, nodes: [
    wireLabel({ name: 'X'.repeat(150), color: 'url(bad)', width: -20, height: 5000, cable: 'omit' }),
  ] }));
  assert.ok(parsed);
  assert.equal(parsed.nodes[0].name.length, 120);
  assert.deepEqual([parsed.nodes[0].color, parsed.nodes[0].width, parsed.nodes[0].height], ['#202631', 1, 600]);
  assert.equal(Object.hasOwn(parsed.nodes[0], 'cable'), false);
  const defaults = fragment([wireLabel({ width: undefined, height: undefined, color: undefined })]);
  assert.deepEqual(labelClipboardBounds(defaults), { x: 900.25, y: 100.5, width: 210, height: 60 });
  const copied = fragment([wireLabel({ x: 0, y: 0, width: 400, height: 160 })]);
  const routes = { existing: { points: [{ x: 300, y: -500 }, { x: 300, y: 500 }] } };
  const pasted = prepareLabelPaste(project(), copied, MODULE_TYPES, { desired: { x: 0, y: 0 }, routes });
  assert.ok(separate(body(pasted.nodes[0]), { x: 300, y: -500, width: 0, height: 1000 }, 10), 'the full wire-label footprint clears existing wire geometry');
});
