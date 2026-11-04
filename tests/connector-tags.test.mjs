import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, TAG_WIDTH, TAG_HEIGHT, TAG_MIN_WIDTH, TAG_MAX_WIDTH, TAG_MIN_HEIGHT, TAG_MAX_HEIGHT, boundsOf, compatiblePorts, geometry, matchingTags, nextTagName, normalizeProject, tagName, tagNameKey, tagWidth, tagHeight } from '../dist/model.js';

const tag = (extra = {}) => ({ id: 'tag-a', kind: 'tag', name: 'NET1', wireSide: 'left', x: 400, y: 100, ...extra });
const device = (extra = {}) => ({ id: 'device', kind: 'device', name: 'Sensor', cable: '17', wireCount: 2, x: 0, y: 100, wireSide: 'right', cableSide: 'left', colors: {}, ...extra });
const module = (extra = {}) => ({ id: 'module', kind: 'module', type: 'AI', name: 'AI', rio: 'RIO A', slot: '5', x: 900, y: 100, ...extra });
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#202631', width: 2.5, ...extra });
const project = (nodes, wires = [], extra = {}) => ({ version: 1, title: 'Connector tags', nodes, wires, settings: { grid: 10, snap: true, autoRoute: false, defaultWidth: 2.5 }, fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION, ...extra });
const normalize = input => normalizeProject(input, MODULE_TYPES);

test('connector tags expose one grid-aligned port on any selected edge', () => {
  assert.equal(TAG_WIDTH, 160);
  assert.equal(TAG_HEIGHT, 40);
  const positions = { left: [0, 20], right: [160, 20], top: [80, 0], bottom: [80, 40] };
  for (const [side, [x, y]] of Object.entries(positions)) {
    const n = tag({ wireSide: side });
    const { ports, obstacles } = geometry([n], MODULE_TYPES);
    assert.deepEqual(Object.keys(ports), ['tag-a:connector']);
    const p = ports['tag-a:connector'];
    assert.deepEqual([p.x, p.y, p.side], [n.x + x, n.y + y, side]);
    assert.equal(p.localId, 'connector');
    assert.equal(p.nodeId, n.id);
    assert.equal(p.kind, 'tag');
    assert.equal(p.name, 'NET1 · connector');
    assert.deepEqual(obstacles, [{ id: n.id, nodeId: n.id, x: n.x, y: n.y, width: 160, height: 40 }]);
  }
});

test('resized tags share their imported dimensions across connectors, obstacles, and export bounds', () => {
  const positions = { left: [0, 60.5], right: [241, 60.5], top: [120.5, 0], bottom: [120.5, 121] };
  for (const [side, [x, y]] of Object.entries(positions)) {
    const first = normalize(project([tag({ wireSide: side, width: '241.4', height: '120.6' })]));
    const n = first.nodes[0];
    assert.deepEqual([n.width, n.height], [241, 121]);
    const { ports, obstacles } = geometry(first.nodes, MODULE_TYPES);
    assert.deepEqual(Object.keys(ports), ['tag-a:connector'], 'resizing keeps the stable connector identity');
    assert.deepEqual([ports['tag-a:connector'].x, ports['tag-a:connector'].y], [n.x + x, n.y + y], side);
    assert.deepEqual(obstacles, [{ id: n.id, nodeId: n.id, x: n.x, y: n.y, width: 241, height: 121 }]);
    assert.deepEqual(boundsOf(first.nodes, MODULE_TYPES), { x: 391, y: 91, width: 259, height: 139 });
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))), first);
  }
});

test('tag sizes use safe defaults, clamp imports, and leave absent dimensions backward compatible', () => {
  assert.deepEqual([TAG_MIN_WIDTH, TAG_MAX_WIDTH, TAG_MIN_HEIGHT, TAG_MAX_HEIGHT], [1, 1000, 1, 600]);
  for (const value of [undefined, null, '', ' ', NaN, Infinity, -Infinity, 'bad', true, [], {}]) {
    assert.equal(tagWidth({ width: value }), 160);
    assert.equal(tagHeight({ height: value }), 40);
  }
  const input = project([
    tag({ id: 'old' }),
    tag({ id: 'empty', width: '', height: null }),
    tag({ id: 'small', width: -50, height: 0 }),
    tag({ id: 'large', width: 10000, height: '10000' }),
    tag({ id: 'invalid', width: {}, height: false }),
    tag({ id: 'width-only', width: '300.7' }),
  ]);
  const first = normalize(input);
  for (const n of first.nodes.slice(0, 2)) {
    assert.equal(Object.hasOwn(n, 'width'), false);
    assert.equal(Object.hasOwn(n, 'height'), false);
    assert.deepEqual([tagWidth(n), tagHeight(n)], [160, 40]);
  }
  assert.deepEqual(first.nodes.slice(2).map(n => [n.width, n.height]), [[1, 1], [1000, 600], [160, 40], [301, undefined]]);
  assert.deepEqual(boundsOf([first.nodes[3]], MODULE_TYPES), { x: 391, y: 91, width: 1018, height: 618 });
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))), first);
});

test('resized connected tags retain dimensions and manual routes after save and reopen', () => {
  const nodes = [device(), tag({ wireSide: 'right', width: 260, height: 100 })];
  const { ports } = geometry(nodes, MODULE_TYPES);
  const from = ports['device:black'], to = ports['tag-a:connector'];
  const point = p => ({ x: p.x, y: p.y });
  const manual = { points: [point(from), { x: 250, y: 120 }, { x: 250, y: 60 }, { x: 700, y: 60 }, { x: 700, y: 150 }, point(to)],
    from: { ...point(from), side: from.side }, to: { ...point(to), side: to.side } };
  const input = project(nodes, [wire('connected', from.id, to.id, { manual, savedRoute: manual })]);
  const first = normalize(input), reopened = normalize(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(first.wires, input.wires);
  assert.deepEqual(reopened, first);
  assert.deepEqual([reopened.nodes[1].width, reopened.nodes[1].height], [260, 100]);
  assert.deepEqual(point(geometry(reopened.nodes, MODULE_TYPES).ports['tag-a:connector']), { x: 660, y: 150 });
});

test('tag names are bounded while explicit blank names remain unlinked after reload', () => {
  assert.equal(tagName(undefined), 'NET1');
  assert.equal(tagName(null), 'NET1');
  assert.equal(tagName('  MOTOR-A  '), 'MOTOR-A');
  assert.equal(tagName(' '.repeat(80)), '');
  assert.equal(tagName('X'.repeat(100)), 'X'.repeat(64));
  assert.equal(tagNameKey('  Motor-A  '), 'motor-a');
  assert.equal(tagNameKey(null), '');
  assert.equal(tagNameKey(' \t\n '), '');
  const oldMissing = tag({ id: 'missing', name: undefined, wireSide: 'invalid' });
  const first = normalize(project([oldMissing, tag({ id: 'empty', name: '' }), tag({ id: 'spaces', name: '   ' }), tag({ id: 'named', name: '  NET1  ' })]));
  assert.deepEqual(first.nodes.map(n => n.name), ['NET1', '', '', 'NET1']);
  assert.equal(first.nodes[0].wireSide, 'right');
  const reopened = normalize(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(reopened, first);
  for (const blank of reopened.nodes.filter(n => n.name === '')) assert.deepEqual(matchingTags(reopened.nodes, blank), []);
  assert.equal(geometry(reopened.nodes, MODULE_TYPES).ports['empty:connector'].name, 'Unnamed tag · connector');
});

test('matching names group only other tags, ignore case and whitespace, and never mutate the project', () => {
  const nodes = [tag({ name: ' MOTOR-A ' }), tag({ id: 'tag-b', name: 'motor-a' }), tag({ id: 'tag-c', name: 'MoToR-A' }), tag({ id: 'other', name: 'MOTOR-B' }), tag({ id: 'empty', name: '' }), tag({ id: 'blank', name: '  ' }), device({ name: 'MOTOR-A' }), module({ name: 'MOTOR-A' })];
  const input = project(nodes), snapshot = structuredClone(input);
  for (const n of nodes) Object.freeze(n);
  Object.freeze(nodes);
  assert.deepEqual(matchingTags(nodes, nodes[0]).map(n => n.id), ['tag-b', 'tag-c']);
  assert.deepEqual(matchingTags(nodes, { ...nodes[1] }).map(n => n.id), ['tag-a', 'tag-c'], 'exclude the selected identity even when supplied as a copy');
  assert.deepEqual(matchingTags(nodes, nodes[4]), []);
  assert.deepEqual(matchingTags(nodes, nodes[6]), []);
  assert.deepEqual(matchingTags(nodes, null), []);
  assert.deepEqual(input, snapshot, 'name membership does not create nodes or long wires');
});

test('new tag names choose the first unused NET number without colliding by case', () => {
  assert.equal(nextTagName([]), 'NET1');
  const nodes = [tag({ name: ' net1 ' }), tag({ id: 'tag-3', name: 'NET3' }), device({ name: 'NET2' })];
  assert.equal(nextTagName(nodes), 'NET2');
  nodes.push(tag({ id: 'tag-2', name: 'NeT2' }));
  assert.equal(nextTagName(nodes), 'NET4');
});

test('tag ports accept devices and every module type in either direction, but never another tag', () => {
  const nodes = [tag(), tag({ id: 'tag-b' }), device(), ...Object.keys(MODULE_TYPES).map((type, i) => module({ id: `module-${i}`, type }))];
  const { ports } = geometry(nodes, MODULE_TYPES);
  const connector = ports['tag-a:connector'];
  for (const other of Object.values(ports).filter(p => p.kind !== 'tag')) {
    assert.equal(compatiblePorts(connector, other), true, other.id);
    assert.equal(compatiblePorts(other, connector), true, other.id);
  }
  assert.equal(compatiblePorts(connector, ports['tag-b:connector']), false);
  assert.equal(compatiblePorts(connector, connector), false);
  assert.equal(compatiblePorts(connector, { ...connector, id: 'tag-a:other' }), false);
  assert.equal(compatiblePorts(connector, { id: 'unknown:port', nodeId: 'unknown', kind: 'unknown' }), false);
});

test('matching tags remain separate saved items with only their physical short connections', () => {
  const nodes = [tag({ name: '  MOTOR ' }), tag({ id: 'tag-b', name: 'motor', wireSide: 'top', x: 800, y: 200 }), device(), module()];
  const input = project(nodes, [wire('device-tag', 'tag-a:connector', 'device:black'), wire('tag-module', 'tag-b:connector', 'module:ch0-minus')]);
  const first = normalize(input), reopened = normalize(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(reopened, first);
  assert.equal(first.nodes.length, 4);
  assert.equal(first.wires.length, 2, 'no synthetic wire is generated between matching names');
  assert.deepEqual(first.nodes.filter(n => n.kind === 'tag').map(n => [n.id, n.name, n.wireSide]), [['tag-a', 'MOTOR', 'left'], ['tag-b', 'motor', 'top']]);
  assert.deepEqual(first.wires.map(w => [w.from, w.to]), [['device:black', 'tag-a:connector'], ['tag-b:connector', 'module:ch0-minus']]);
  assert.deepEqual(matchingTags(first.nodes, first.nodes[0]).map(n => n.id), ['tag-b']);
});

test('tag connector occupancy is enforced in both endpoint positions without merging names', () => {
  const nodes = [tag(), tag({ id: 'tag-b' }), device(), module()];
  assert.throws(() => normalize(project(nodes, [wire('a', 'device:black', 'tag-a:connector'), wire('b', 'tag-a:connector', 'module:ch0-minus')])), /connector tag is connected more than once/);
  assert.throws(() => normalize(project(nodes, [wire('a', 'tag-a:connector', 'module:ch0-minus'), wire('b', 'device:black', 'tag-a:connector')])), /connector tag is connected more than once/);
  assert.throws(() => normalize(project(nodes, [wire('a', 'tag-a:connector', 'module:ch0-minus'), wire('b', 'module:ch0-minus', 'tag-b:connector')])), /channel terminal is connected more than once/);
  assert.throws(() => normalize(project(nodes, [wire('a', 'device:black', 'tag-a:connector'), wire('b', 'tag-b:connector', 'device:black')])), /conductor is connected more than once/);
  const distinct = normalize(project(nodes, [wire('a', 'device:black', 'tag-a:connector'), wire('b', 'device:white', 'tag-b:connector')]));
  assert.equal(distinct.wires.length, 2, 'two matching tags each own one physical connector');
  assert.throws(() => normalize(project(nodes, [wire('a', 'tag-a:connector', 'tag-b:connector')])), /missing or incompatible/);
  assert.throws(() => normalize(project(nodes, [wire('a', 'device:black', 'tag-a:missing')])), /missing or incompatible/);
});

test('tag manual bends and anchors survive import reversal and all four connector sides', () => {
  const middle = {
    left: [{ x: 250, y: 110 }, { x: 250, y: 120 }],
    right: [{ x: 250, y: 110 }, { x: 250, y: 60 }, { x: 600, y: 60 }, { x: 600, y: 120 }],
    top: [{ x: 250, y: 110 }, { x: 250, y: 60 }, { x: 480, y: 60 }],
    bottom: [{ x: 250, y: 110 }, { x: 250, y: 180 }, { x: 480, y: 180 }],
  };
  for (const side of Object.keys(middle)) {
    const nodes = [device({ y: 90 }), tag({ wireSide: side })], geo = geometry(nodes, MODULE_TYPES);
    const source = geo.ports['device:black'], destination = geo.ports['tag-a:connector'];
    const point = p => ({ x: p.x, y: p.y });
    const anchor = p => ({ ...point(p), side: p.side });
    const manual = { points: [point(source), ...middle[side], point(destination)], from: anchor(source), to: anchor(destination) };
    const reversed = { points: manual.points.slice().reverse(), from: manual.to, to: manual.from };
    const first = normalize(project(nodes, [wire('a', destination.id, source.id, { manual: reversed, savedRoute: reversed })]));
    assert.equal(first.wires[0].from, source.id);
    assert.deepEqual(first.wires[0].manual, manual, side);
    assert.deepEqual(first.wires[0].savedRoute, manual, side);
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))), first, side);
    const renamed = structuredClone(first);
    renamed.nodes.find(n => n.kind === 'tag').name = 'NEW-NET';
    assert.deepEqual(normalize(renamed).wires, first.wires, 'renaming a tag preserves its physical route');
  }
});

test('legacy four-wire color migration also preserves connections to tags', () => {
  const input = project([device({ wireCount: 4 }), tag()], [wire('a', 'tag-a:connector', 'device:green', { color: '#2b9b68' })]);
  delete input.fourWireOrderRevision;
  const result = normalize(input);
  assert.equal(result.wires[0].from, 'device:white');
  assert.equal(result.wires[0].to, 'tag-a:connector');
  assert.equal(result.wires[0].color, '#ffffff');
});

test('tag-free projects retain their wiring and old tags keep their default export bounds', () => {
  const old = project([device(), module()], [wire('old', 'device:black', 'module:ch0-minus')]);
  const first = normalize(old);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))), first);
  assert.equal(first.nodes.some(n => n.kind === 'tag'), false);
  assert.deepEqual(first.wires, old.wires);
  const n = tag({ x: 50, y: 80 });
  assert.deepEqual(boundsOf([n], MODULE_TYPES), { x: 41, y: 71, width: 178, height: 100 });
  const b = boundsOf([n], MODULE_TYPES, { lead: { points: [{ x: -20, y: 100 }, { x: 50, y: 100 }] } });
  assert.equal(b.x, -20);
  assert.ok(b.x + b.width >= 50 + TAG_WIDTH && b.y + b.height >= 80 + TAG_HEIGHT);
});
