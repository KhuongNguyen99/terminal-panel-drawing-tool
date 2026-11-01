import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, boundsOf, compatiblePorts, geometry, modulePortLabel, normalizeProject, terminalRowName } from '../dist/model.js';
import { routeWires } from '../dist/router.js';

const rail = (extra = {}) => ({ id: 'rail', kind: 'module', type: 'DIN_RESISTOR', name: 'DIN Resistor Rail Terminal Block', rio: 'Panel A', slot: '', x: 400, y: 100, ...extra });
const io = (extra = {}) => ({ id: 'io', kind: 'module', type: 'AI', name: 'AI', rio: 'RIO A', slot: '5', x: 1200, y: 100, ...extra });
const device = () => ({ id: 'device', kind: 'device', name: 'Sensor', cable: '17', x: 0, y: 0, wireCount: 2, cableSide: 'left', wireSide: 'right', colors: {} });
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#202631', width: 2.5, ...extra });
const project = (wires = [], nodes = [rail(), io(), device()]) => ({ version: 1, title: 'Terminal bank', nodes, wires, fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION, settings: { grid: 10, snap: true, autoRoute: false, defaultWidth: 2.5 } });
const normalize = input => normalizeProject(input, MODULE_TYPES);

test('DIN bank exposes one ordered row of ten neutral terminals at each end', () => {
  const type = MODULE_TYPES.DIN_RESISTOR;
  assert.equal(type.label, 'DIN Resistor Rail Terminal Block');
  assert.equal(type.ports.length, 20);
  assert.equal(type.connectorRole, 'terminal');
  assert.equal(type.body.w / type.body.h, 2384 / 2055, 'artwork keeps its approved proportions');
  for (const side of ['top', 'bottom']) {
    const ports = type.ports.filter(port => port.side === side);
    assert.equal(ports.length, 10);
    assert.deepEqual(ports.map(p => p.id), Array.from({ length: 10 }, (_, i) => `${side}-${i + 1}`));
    assert.deepEqual(ports.map(p => p.channel), Array.from({ length: 10 }, (_, i) => i));
    assert.equal(new Set(ports.map(p => p.y)).size, 1, 'ports form a single horizontal row');
    assert.ok(ports.every(p => p.signal === side && p.x % 10 === 0 && p.y % 10 === 0));
    assert.ok(ports.every((p, i) => !i || p.x > ports[i - 1].x), 'numbering runs left to right');
    assert.ok(ports.every(p => p.pinX > type.body.x && p.pinX < type.body.x + type.body.w));
    assert.ok(ports.every(p => side === 'top' ? p.pinY > p.y : p.pinY < p.y), 'callouts point inward to the physical openings');
  }
});

test('DIN title sits above the bank and has its own routing obstacle owner', () => {
  const n = rail(), t = MODULE_TYPES.DIN_RESISTOR;
  const { ports, obstacles } = geometry([n], MODULE_TYPES);
  assert.equal(Object.keys(ports).length, 20);
  assert.ok(Object.values(ports).every(p => p.connectorRole === 'terminal' && p.kind === 'module'));
  assert.equal(ports['rail:top-1'].y, n.y);
  assert.equal(ports['rail:bottom-10'].y, n.y + t.height);
  const body = obstacles.filter(o => o.nodeId === n.id);
  assert.ok(body.length && body.every(o => o.y >= n.y && o.y + o.height <= n.y + t.height), 'port owner escape stops at the body boundary');
  assert.ok(t.header.y + t.header.height < 0, 'title is above the top connector row');
  const title = obstacles.find(o => o.x <= n.x + t.header.x && o.y <= n.y + t.header.y && o.x + o.width >= n.x + t.header.x + t.header.width && o.y + o.height >= n.y + t.header.y + t.header.height);
  assert.ok(title, 'title is represented in routing geometry');
  assert.notEqual(title.nodeId, n.id, 'outward stubs cannot cross the title under the owner exception');
  assert.equal(title.nodeId, title.id);
  const b = boundsOf([n], MODULE_TYPES);
  assert.ok(b.x < n.x && b.y < n.y + t.header.y && b.x + b.width > n.x + t.width && b.y + b.height > n.y + t.height);
});

test('every top connector can route around the detached title instead of crossing it', () => {
  const n = rail(), t = MODULE_TYPES.DIN_RESISTOR;
  const title = { x: n.x + t.header.x, y: n.y + t.header.y, width: t.header.width, height: t.header.height };
  for (const terminal of t.ports.filter(p => p.side === 'top')) {
    // A real right-facing cable label above the title must detour around the
    // title to reach each downward-facing row position independently.
    const source = { ...device(), id: 'source', x: n.x + terminal.x - 210, y: title.y - 100 };
    const geo = geometry([n, source], MODULE_TYPES);
    const from = 'source:black', to = `${n.id}:${terminal.id}`;
    const route = routeWires({ ...geo, wires: [wire('test-route', from, to)], grid: 10 }).routes['test-route'];
    assert.notEqual(route.status, 'blocked', `${terminal.id} stays connectable with a title above it`);
    assert.ok(route.points.length >= 2);
    assert.deepEqual(route.points.at(-1), { x: geo.ports[to].x, y: geo.ports[to].y });
    assert.equal(route.points.at(-2).x, geo.ports[to].x);
    assert.ok(route.points.at(-2).y < geo.ports[to].y, 'wire approaches the top connector from above');
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const crossesTitle = a.x === b.x
        ? a.x > title.x && a.x < title.x + title.width && Math.min(a.y, b.y) < title.y + title.height && Math.max(a.y, b.y) > title.y
        : a.y > title.y && a.y < title.y + title.height && Math.min(a.x, b.x) < title.x + title.width && Math.max(a.x, b.x) > title.x;
      assert.equal(crossesTitle, false, `${terminal.id} does not cross its own title`);
    }
  }
});

test('each logical DIN connector points to both physical holes at its end', () => {
  const type = MODULE_TYPES.DIN_RESISTOR;
  const targets = [];
  for (const port of type.ports) {
    assert.equal(port.pinTargets.length, 2);
    assert.deepEqual(port.pinTargets[0], { x: port.pinX, y: port.pinY }, 'outer hole remains the original target');
    for (const target of port.pinTargets) {
      assert.ok(target.x > type.body.x && target.x < type.body.x + type.body.w);
      assert.ok(target.y > type.body.y && target.y < type.body.y + type.body.h);
      assert.ok(port.side === 'top' ? target.y > port.y : target.y < port.y);
      targets.push(`${target.x},${target.y}`);
    }
  }
  assert.equal(type.ports.length, 20, 'one wire connection point remains per terminal end');
  assert.equal(new Set(targets).size, 40, 'all forty distinct physical holes receive an arrow');
});

test('old DIN files and unnamed rows receive TB10/TB11 display names', () => {
  const old = normalize(project([], [rail(), io()]));
  const [terminal, regular] = old.nodes;
  assert.equal(terminal.topRowName, 'TB10');
  assert.equal(terminal.bottomRowName, 'TB11');
  assert.equal('topRowName' in regular, false, 'ordinary I/O module data is unaffected');
  assert.equal('bottomRowName' in regular, false);
  const ports = geometry(old.nodes, MODULE_TYPES).ports;
  assert.equal(ports['rail:top-1'].label, 'TB10.1');
  assert.equal(ports['rail:top-10'].label, 'TB10.10');
  assert.equal(ports['rail:bottom-1'].label, 'TB11.1');
  assert.equal(ports['rail:bottom-10'].label, 'TB11.10');
  assert.equal(ports['rail:top-1'].name, `${terminal.name} · TB10.1`);
  assert.equal(modulePortLabel(regular, MODULE_TYPES.AI.ports[0]), MODULE_TYPES.AI.ports[0].label);
  const empty = normalize(project([], [rail({ topRowName: '   ', bottomRowName: '' })]));
  assert.equal(empty.nodes[0].topRowName, 'TB10');
  assert.equal(empty.nodes[0].bottomRowName, 'TB11');
});

test('DIN row labels can be independently renamed and are trimmed and bounded', () => {
  const original = rail(), changed = rail({ topRowName: '  SENSOR-TB  ' });
  const before = geometry([original], MODULE_TYPES).ports;
  const after = geometry([changed], MODULE_TYPES).ports;
  assert.equal(terminalRowName(changed, 'top'), 'SENSOR-TB');
  for (let i = 1; i <= 10; i++) {
    assert.equal(after[`rail:top-${i}`].label, `SENSOR-TB.${i}`);
    assert.equal(after[`rail:bottom-${i}`].label, before[`rail:bottom-${i}`].label);
  }
  const renamed = normalize(project([], [rail({ topRowName: ' A '.repeat(30), bottomRowName: '  FIELD-B  ' })]));
  assert.ok(renamed.nodes[0].topRowName.length <= 24);
  assert.equal(renamed.nodes[0].topRowName, renamed.nodes[0].topRowName.trim());
  assert.equal(renamed.nodes[0].bottomRowName, 'FIELD-B');
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(renamed))), renamed);
});

test('DIN wiring accepts cable conductors and I/O ports but rejects incompatible endpoints', () => {
  const nodes = [rail(), io(), device(), rail({ id: 'rail2', x: 2000 })];
  const { ports } = geometry(nodes, MODULE_TYPES);
  assert.equal(compatiblePorts(ports['device:black'], ports['rail:top-1']), true);
  assert.equal(compatiblePorts(ports['rail:bottom-1'], ports['io:ch0-minus']), true);
  assert.equal(compatiblePorts(ports['io:ch0-minus'], ports['rail:bottom-1']), true);
  assert.equal(compatiblePorts(ports['rail:top-1'], ports['rail2:bottom-1']), true);
  assert.equal(compatiblePorts(ports['rail:top-1'], ports['rail:bottom-1']), false);
  assert.equal(compatiblePorts(ports['device:black'], ports['device:white']), false);
  assert.equal(compatiblePorts(undefined, ports['rail:top-1']), false);
  const io2 = io({ id: 'io2', x: 1600 });
  const ioPorts = geometry([io(), io2], MODULE_TYPES).ports;
  assert.equal(compatiblePorts(ioPorts['io:ch0-minus'], ioPorts['io2:ch0-minus']), false);
});

test('DIN project save/reopen retains both rows and module-to-module endpoint direction', () => {
  const input = project([
    wire('cable-top', 'device:black', 'rail:top-1'),
    wire('rail-io', 'rail:bottom-1', 'io:ch0-minus'),
    wire('io-rail', 'io:ch0-plus', 'rail:bottom-2', { color: '#ffffff' }),
    wire('last-top', 'rail:top-10', 'device:white'),
  ]);
  const first = normalize(input), reopened = normalize(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(reopened, first);
  assert.equal(first.wires[1].from, 'rail:bottom-1');
  assert.equal(first.wires[2].from, 'io:ch0-plus');
  assert.equal(first.wires[3].from, 'device:white', 'legacy device-to-module orientation remains canonical');
  const fallbackColor = normalize(project([wire('default-color', 'rail:bottom-1', 'io:ch0-minus', { color: 'invalid' })]));
  assert.equal(fallbackColor.wires[0].color, '#202631');
});

test('DIN terminal occupancy is checked on either end regardless of wire orientation', () => {
  assert.throws(() => normalize(project([
    wire('a', 'device:black', 'rail:top-1'), wire('b', 'rail:top-1', 'io:ch0-minus'),
  ])), /terminal is connected more than once/);
  assert.throws(() => normalize(project([
    wire('a', 'rail:bottom-1', 'io:ch0-minus'), wire('b', 'io:ch0-minus', 'rail:bottom-2'),
  ])), /terminal is connected more than once/);
  assert.throws(() => normalize(project([
    wire('a', 'rail:top-1', 'device:black'), wire('b', 'device:black', 'rail:top-2'),
  ])), /conductor is connected more than once/);
});

test('DIN imports reject non-existent terminals, self-wiring, and unrelated I/O pairs', () => {
  assert.throws(() => normalize(project([wire('a', 'device:black', 'rail:top-11')])), /missing or incompatible/);
  assert.throws(() => normalize(project([wire('a', 'rail:top-1', 'rail:bottom-1')])), /missing or incompatible/);
  assert.throws(() => normalize(project([wire('a', 'io:ch0-minus', 'io2:ch0-minus')], [io(), io({ id: 'io2' })])), /missing or incompatible/);
});

test('top/bottom saved manual anchors survive save/reopen and reversed cable imports', () => {
  const ports = geometry([rail(), device()], MODULE_TYPES).ports;
  const from = ports['device:black'], to = ports['rail:top-1'];
  const anchor = p => ({ x: p.x, y: p.y, side: p.side });
  const manual = {
    from: anchor(from), to: anchor(to),
    points: [{ x: from.x, y: from.y }, { x: 260, y: from.y }, { x: 260, y: 50 }, { x: to.x, y: 50 }, { x: to.x, y: to.y }],
  };
  const input = project([wire('a', from.id, to.id, { manual, savedRoute: manual })]);
  const first = normalize(input);
  assert.deepEqual(first.wires[0].manual, manual);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))).wires[0].savedRoute, manual);
  const reversed = { points: manual.points.slice().reverse(), from: manual.to, to: manual.from };
  const imported = normalize(project([wire('b', to.id, from.id, { manual: reversed, savedRoute: reversed })]));
  assert.deepEqual(imported.wires[0].manual, manual);
  assert.deepEqual(imported.wires[0].savedRoute, manual);
  const edited = JSON.parse(JSON.stringify(first));
  edited.nodes.find(n => n.id === 'rail').topRowName = 'TB20';
  edited.nodes.find(n => n.id === 'rail').bottomRowName = 'TB21';
  const renamed = normalize(edited);
  assert.deepEqual(renamed.wires, first.wires, 'renaming rows preserves wire IDs, endpoints, colors, and saved/manual bends');
  const before = geometry(first.nodes, MODULE_TYPES).ports, after = geometry(renamed.nodes, MODULE_TYPES).ports;
  assert.deepEqual(Object.keys(after), Object.keys(before), 'display labels never become endpoint IDs');
  for (const id of Object.keys(before)) {
    assert.deepEqual([after[id].x, after[id].y, after[id].side], [before[id].x, before[id].y, before[id].side]);
  }
  assert.equal(after['rail:top-1'].label, 'TB20.1');
  assert.equal(after['rail:bottom-1'].label, 'TB21.1');
});
