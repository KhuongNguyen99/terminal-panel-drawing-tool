import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { CONDUCTORS, FOUR_WIRE_ORDER_REVISION, boundsOf, compatiblePorts, geometry, normalizeProject,
  synchronizeWireLabelColors, setConnectedWireColor, setConductorColor } from '../dist/model.js';

const label = (extra = {}) => ({ id: 'label', kind: 'wire-label', name: 'Valve position', x: 400, y: 100, ...extra });
const device = (extra = {}) => ({ id: 'device', kind: 'device', name: 'Cable', cable: '17', wireCount: 2,
  wireSide: 'right', cableSide: 'left', x: 0, y: 100, colors: {}, ...extra });
const module = (extra = {}) => ({ id: 'module', kind: 'module', type: 'AI', name: 'AI', rio: 'RIO A', slot: '5', x: 900, y: 0, ...extra });
const tag = (extra = {}) => ({ id: 'tag', kind: 'tag', name: 'NET1', wireSide: 'left', x: 1500, y: 100, ...extra });
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#778899', width: 3.5, ...extra });
const rawProject = (nodes, wires = []) => ({ version: 1, title: 'Continuous wire labels', nodes, wires,
  settings: { grid: 10, snap: true, autoRoute: false, defaultWidth: 2.5 }, fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION });
const project = (nodes, wires = []) => normalizeProject(rawProject(nodes, wires), MODULE_TYPES);
const copy = value => JSON.parse(JSON.stringify(value));
const chainWires = (key = 'black') => [wire('cable-side', `device:${key}`, 'label:left'), wire('module-side', 'label:right', 'module:ch0-minus')];
const colors = p => Object.fromEntries(p.wires.map(w => [w.id, w.color]));
const withoutColors = p => {
  const clone = copy(p);
  for (const n of clone.nodes) { delete n.color; delete n.colors; }
  for (const w of clone.wires) delete w.color;
  return clone;
};

test('wire labels expose only left/right midpoint connectors and use their actual dimensions', () => {
  const n = label({ color: '#ffffff' });
  let geo = geometry([n], MODULE_TYPES);
  assert.deepEqual(Object.keys(geo.ports), ['label:left', 'label:right']);
  assert.deepEqual(Object.values(geo.ports).map(p => [p.x, p.y, p.side, p.color, p.kind]),
    [[400, 130, 'left', '#ffffff', 'wire-label'], [610, 130, 'right', '#ffffff', 'wire-label']]);
  assert.deepEqual(geo.obstacles, [{ id: 'label', nodeId: 'label', x: 400, y: 100, width: 210, height: 60 }]);
  assert.equal(geo.ports['label:left'].name, 'Valve position · left connector');
  const resized = label({ width: 321, height: 93 });
  geo = geometry([resized], MODULE_TYPES);
  assert.deepEqual(Object.values(geo.ports).map(p => [p.x, p.y]), [[400, 146.5], [721, 146.5]]);
  assert.deepEqual([geo.obstacles[0].width, geo.obstacles[0].height], [321, 93]);
  assert.deepEqual(boundsOf([resized], MODULE_TYPES), { x: 391, y: 91, width: 339, height: 111 });
});

test('wire-label imports retain bounded appearance while omitting all cable and conductor metadata', () => {
  const first = project([label({ width: '350.8', height: 900, color: 'url(bad)', name: 'X'.repeat(150), cable: '42', wireCount: 4,
    wireSide: 'top', cableSide: 'right', colors: { red: '#ff0000' }, assignment: { moduleId: 'module', channel: 0 }, scheduleId: 'source' }), module()]);
  const n = first.nodes[0];
  assert.deepEqual(Object.keys(n).sort(), ['color', 'height', 'id', 'kind', 'name', 'width', 'x', 'y']);
  assert.deepEqual([n.width, n.height, n.color, n.name.length], [351, 600, '#202631', 120]);
  const defaults = project([label()]).nodes[0];
  assert.equal(Object.hasOwn(defaults, 'width'), false);
  assert.equal(Object.hasOwn(defaults, 'height'), false);
  assert.equal(Object.hasOwn(defaults, 'color'), false);
  const minimum = project([label({ width: 0, height: 0 })]).nodes[0];
  assert.deepEqual([minimum.width, minimum.height], [160, 60]);
  assert.deepEqual(normalizeProject(copy(first), MODULE_TYPES), first);
});

test('wire-label ports accept devices, modules, tags, and other labels but enforce one wire per port', () => {
  const nodes = [label(), label({ id: 'label2', x: 700 }), device(), module(), tag()];
  const { ports } = geometry(nodes, MODULE_TYPES), connector = ports['label:left'];
  for (const other of [ports['device:black'], ports['module:ch0-minus'], ports['tag:connector'], ports['label2:right']]) {
    assert.equal(compatiblePorts(connector, other), true);
    assert.equal(compatiblePorts(other, connector), true);
  }
  assert.equal(compatiblePorts(connector, ports['label:right']), false);
  assert.equal(compatiblePorts(connector, connector), false);
  assert.equal(compatiblePorts(ports['device:black'], ports['device:white']), false);
  assert.throws(() => project(nodes, [wire('a', 'device:black', 'label:left'), wire('b', 'label:left', 'module:ch0-minus')]), /wire label connector is connected more than once/);
  assert.throws(() => project(nodes, [wire('a', 'label:right', 'module:ch0-minus'), wire('b', 'tag:connector', 'label:right')]), /wire label connector is connected more than once/);
  assert.throws(() => project(nodes, [wire('a', 'label:left', 'label:right')]), /missing or incompatible/);
  assert.throws(() => project(nodes, [wire('a', 'device:black', 'label:black')]), /missing or incompatible/);
  const valid = project(nodes, [wire('a', 'label:left', 'device:black'), wire('b', 'module:ch0-minus', 'label:right')]);
  assert.deepEqual(valid.wires.map(w => [w.from, w.to]), [['device:black', 'label:left'], ['module:ch0-minus', 'label:right']]);
});

test('two- and four-wire cable colors including white drive both label connectors and all attached sections', () => {
  const custom = { red: '#be2200', black: '#142536', white: '#ffffff', green: '#51a26f' };
  for (const wireCount of [2, 4]) for (const conductor of CONDUCTORS[wireCount]) {
    const p = project([device({ wireCount, colors: custom }), label({ color: '#ff00ff' }), module()], chainWires(conductor.key));
    const color = custom[conductor.key];
    assert.deepEqual(Object.values(colors(p)), [color, color]);
    assert.equal(p.nodes.find(n => n.kind === 'wire-label').color, color);
    const ports = geometry(p.nodes, MODULE_TYPES).ports;
    assert.equal(ports['label:left'].color, color);
    assert.equal(ports['label:right'].color, color);
    for (const other of CONDUCTORS[wireCount]) assert.equal(p.nodes[0].colors[other.key], custom[other.key]);
    assert.equal(synchronizeWireLabelColors(p).changed, false, 'settled chains synchronize idempotently');
  }
});

test('cable-first and module-first connection orders both adopt the cable conductor color', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const p = project([device({ colors: { black: '#4488cc' } }), label({ color: '#ff00ff' }), module()]);
    const connections = chainWires();
    for (const index of order) {
      p.wires.push(connections[index]);
      synchronizeWireLabelColors(p, index === 0 ? { preferredPortId: 'device:black' } : {});
    }
    assert.equal(p.nodes[0].colors.black, '#4488cc', 'the label never supplies a connected cable color');
    assert.equal(p.nodes[1].color, '#4488cc');
    assert.deepEqual(new Set(Object.values(colors(p))), new Set(['#4488cc']));
  }
});

test('multi-label chains recolor from either section without changing unrelated conductor paths', () => {
  const p = project([device({ wireCount: 4, colors: { black: '#112233', white: '#eeeeee' } }), label(), label({ id: 'label2', x: 700 }), module()],
    [wire('cable-side', 'device:black', 'label:left'), wire('middle', 'label:right', 'label2:left'), wire('module-side', 'label2:right', 'module:ch0-minus'),
      wire('independent', 'device:white', 'module:ch0-plus', { color: '#708090', width: 6 })]);
  const structure = withoutColors(p), independent = copy(p.wires[3]);
  const result = setConnectedWireColor(p, 'module-side', '#ffffff');
  assert.equal(result.changed, true);
  assert.deepEqual(new Set(result.changedWires), new Set(['cable-side', 'middle', 'module-side']));
  assert.deepEqual(result.changedConductors, ['device:black']);
  assert.deepEqual(new Set(result.changedLabels), new Set(['label', 'label2']));
  assert.equal(p.nodes[0].colors.black, '#ffffff');
  assert.equal(p.nodes[0].colors.white, '#eeeeee');
  assert.deepEqual(p.wires[3], independent);
  assert.deepEqual(withoutColors(p), structure);
  setConductorColor(p, 'device', 'black', '#ff6600');
  assert.deepEqual(p.wires.slice(0, 3).map(w => w.color), ['#ff6600', '#ff6600', '#ff6600']);
  assert.equal(synchronizeWireLabelColors(p).changed, false);
  assert.deepEqual(p.wires[3], independent);
});

test('module terminals, other cable conductors, and matching virtual tags never join color chains', () => {
  const nodes = [device({ wireCount: 4 }), module(), tag({ id: 'tag-a' }), tag({ id: 'tag-b' }),
    ...['black', 'white', 'red', 'green'].map(key => label({ id: `label-${key}` }))];
  const wires = ['black', 'white', 'red', 'green'].flatMap(key => [wire(`${key}-in`, `device:${key}`, `label-${key}:left`),
    wire(`${key}-out`, `label-${key}:right`, key === 'black' ? 'module:ch0-minus' : key === 'white' ? 'module:ch0-plus' : `tag-${key === 'red' ? 'a' : 'b'}:connector`)]);
  const p = project(nodes, wires), before = colors(p);
  setConnectedWireColor(p, 'black-out', '#123456');
  for (const [id, color] of Object.entries(before)) if (!id.startsWith('black')) assert.equal(colors(p)[id], color);
  setConnectedWireColor(p, 'red-in', '#abcdef');
  assert.equal(colors(p)['green-in'], before['green-in']);
  assert.equal(colors(p)['green-out'], before['green-out']);
  assert.equal(p.nodes[0].colors.white, '#ffffff');
});

test('conflicting cable anchors resolve deterministically or use the explicitly preferred conductor', () => {
  const make = () => {
    const p = project([device({ id: 'a', colors: { black: '#123456' } }), device({ id: 'b', colors: { white: '#ffffff' } }), label()]);
    p.wires = [wire('right', 'b:white', 'label:right'), wire('left', 'label:left', 'a:black')];
    return p;
  };
  const lexical = make(), report = synchronizeWireLabelColors(lexical);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].sourcePortId, 'a:black');
  assert.equal(lexical.nodes[1].colors.white, '#123456');
  assert.deepEqual(Object.values(colors(lexical)), ['#123456', '#123456']);
  const preferred = make();
  const chosen = synchronizeWireLabelColors(preferred, { preferredPortId: 'b:white' });
  assert.equal(chosen.conflicts[0].sourcePortId, 'b:white');
  assert.equal(preferred.nodes[0].colors.black, '#ffffff');
  assert.deepEqual(Object.values(colors(preferred)), ['#ffffff', '#ffffff']);
  setConnectedWireColor(preferred, 'left', '#ddeeaa');
  assert.equal(preferred.nodes[0].colors.black, '#ddeeaa');
  assert.equal(preferred.nodes[1].colors.white, '#ddeeaa');
  assert.equal(preferred.nodes[0].colors.white, '#ffffff');
  assert.equal(preferred.nodes[1].colors.black, '#202631');
});

test('disconnect and reconnect retain remaining colors and then inherit the newly connected cable', () => {
  const p = project([device({ colors: { black: '#2468ac' } }), device({ id: 'replacement', colors: { white: '#ffffff' } }), label(), module()], chainWires());
  p.wires = p.wires.filter(w => w.id !== 'cable-side');
  synchronizeWireLabelColors(p);
  assert.equal(p.wires[0].color, '#2468ac');
  assert.equal(p.nodes[2].color, '#2468ac');
  setConnectedWireColor(p, 'module-side', '#ffcc00');
  assert.equal(p.nodes[0].colors.black, '#2468ac', 'a detached cable is no longer recolored');
  p.wires.push(wire('reconnected', 'label:left', 'replacement:white'));
  synchronizeWireLabelColors(p, { preferredPortId: 'replacement:white' });
  assert.deepEqual(Object.values(colors(p)), ['#ffffff', '#ffffff']);
  assert.equal(p.nodes[2].color, '#ffffff');
  p.wires = [];
  synchronizeWireLabelColors(p);
  assert.equal(p.nodes[2].color, '#ffffff', 'an isolated label retains its last connection color');
});

test('closed label cycles terminate and settle to the same color regardless of array order', () => {
  const nodes = [label({ id: 'one' }), label({ id: 'two' })];
  const wires = [wire('b', 'two:right', 'one:left', { color: '#ffffff' }), wire('a', 'one:right', 'two:left', { color: '#102030' })];
  const first = project(nodes, wires), reversed = project(nodes.slice().reverse(), wires.slice().reverse());
  assert.deepEqual(new Set(Object.values(colors(first))), new Set(['#102030']));
  assert.deepEqual(colors(first), colors(reversed));
  assert.ok(first.nodes.every(n => n.color === '#102030'));
  setConnectedWireColor(first, 'b', '#ffffff');
  assert.ok(first.nodes.every(n => n.color === '#ffffff'));
  assert.deepEqual(Object.values(colors(first)), ['#ffffff', '#ffffff']);
  assert.equal(synchronizeWireLabelColors(first).changed, false);
});

test('manual routes, widths, endpoint IDs, and undo snapshots survive color edits and saved-project normalization', () => {
  const nodes = [device({ colors: { black: '#456789' } }), label(), module()];
  const manual = { points: [{ x: 400, y: 130 }, { x: 300, y: 130 }, { x: 300, y: 120 }, { x: 210, y: 120 }],
    from: { x: 400, y: 130, side: 'left' }, to: { x: 210, y: 120, side: 'right' } };
  const p = project(nodes, [wire('cable-side', 'label:left', 'device:black', { manual, savedRoute: manual }), chainWires()[1]]);
  assert.equal(p.wires[0].from, 'device:black');
  assert.deepEqual(p.wires[0].manual.points, manual.points.slice().reverse());
  const before = copy(p), routeIdentity = p.wires[0].manual, savedIdentity = p.wires[0].savedRoute;
  setConnectedWireColor(p, 'module-side', '#ffffff');
  assert.equal(p.wires[0].manual, routeIdentity);
  assert.equal(p.wires[0].savedRoute, savedIdentity);
  assert.deepEqual(withoutColors(p), withoutColors(before));
  assert.deepEqual(normalizeProject(copy(p), MODULE_TYPES), p);
  assert.deepEqual(normalizeProject(copy(before), MODULE_TYPES), before, 'an undo snapshot restores its source and section colors');
});

test('legacy four-wire color migration precedes wire-label synchronization', () => {
  const input = rawProject([device({ wireCount: 4 }), label({ color: '#2b9b68' }), module()],
    [wire('cable-side', 'label:left', 'device:green', { color: '#2b9b68' }), chainWires()[1]]);
  delete input.fourWireOrderRevision;
  const p = normalizeProject(input, MODULE_TYPES);
  assert.equal(p.wires[0].from, 'device:white');
  assert.deepEqual(Object.values(colors(p)), ['#ffffff', '#ffffff']);
  assert.equal(p.nodes[1].color, '#ffffff');
  assert.deepEqual(normalizeProject(copy(p), MODULE_TYPES), p);
});

test('ordinary wire edits remain independent and conductor setters update only their own connections', () => {
  const p = project([device(), module()], [wire('black', 'device:black', 'module:ch0-minus'), wire('white', 'device:white', 'module:ch0-plus')]);
  const before = copy(p);
  assert.equal(synchronizeWireLabelColors(p).changed, false);
  setConnectedWireColor(p, 'black', '#ff4400');
  assert.equal(p.nodes[0].colors.black, '#202631');
  assert.deepEqual(p.wires[1], before.wires[1]);
  setConductorColor(p, 'device', 'white', '#abcdef');
  assert.equal(p.nodes[0].colors.white, '#abcdef');
  assert.equal(p.wires[1].color, '#abcdef');
  assert.equal(p.wires[0].color, '#ff4400');
  assert.equal(setConductorColor(p, 'device', 'green', '#ffffff').changed, false);
  assert.equal(setConnectedWireColor(p, 'missing', '#ffffff').changed, false);
});
