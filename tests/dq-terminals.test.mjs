import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODULE_TYPES } from '../dist/modules.js';
import { compatiblePorts, geometry, normalizeProject } from '../dist/model.js';
import { routeWithPreferences } from '../dist/independent-routing.js';

const copy = value => JSON.parse(JSON.stringify(value));
const dq = (extra = {}) => ({ id: 'dq', kind: 'module', type: 'DQ', name: 'Digital outputs', rio: 'RIO A', slot: '1', x: 400, y: 0, ...extra });
const cable = (extra = {}) => ({ id: 'cable', kind: 'device', name: 'Cable', wireCount: 2, wireSide: 'right', x: 0, y: 410, ...extra });
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#294d7a', width: 3.5, ...extra });
const project = (nodes, wires) => ({ version: 1, title: 'DQ terminal check', nodes, wires,
  settings: { grid: 10, snap: true, autoRoute: false, defaultWidth: 2.5 } });
const normalize = input => normalizeProject(input, MODULE_TYPES);
const zeroPorts = () => MODULE_TYPES.DQ.ports.filter(p => p.signal === '0V');
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message);

test('DQ exposes eight distinct 0V terminals with compact labels and unique connection names', () => {
  const terminals = zeroPorts();
  assert.equal(terminals.length, 8);
  assert.equal(MODULE_TYPES.DQ.ports.length, 16);
  assert.deepEqual(terminals.map(p => p.id), [
    '0v-left-1', '0v-left-2', 'common-0v', '0v-left-4',
    '0v-right-1', '0v-right-2', '0v-right-3', '0v-right-4',
  ]);
  assert.equal(new Set(terminals.map(p => `${p.x},${p.y}`)).size, 8);
  const n = dq({ x: 725, y: 90 }), { ports } = geometry([n], MODULE_TYPES);
  for (const side of ['left', 'right']) {
    const row = terminals.filter(p => p.side === side);
    assert.deepEqual(row.map(p => p.y), [390, 410, 430, 450]);
    row.forEach((p, index) => {
      assert.equal(p.x, side === 'left' ? 60 : 300);
      assert.equal(p.label, '0V');
      assert.equal(p.channel, null, '0V terminals are not numbered output channels');
      assert.equal(p.connectionLabel, `0V · ${side} terminal ${index + 1}`);
      assert.equal(Boolean(p.common || p.allowMultiple), false, 'each physical terminal accepts only one wire');
      const resolved = ports[`dq:${p.id}`];
      assert.deepEqual([resolved.x, resolved.y, resolved.side], [n.x + p.x, n.y + p.y, side]);
      assert.equal(resolved.label, '0V');
      assert.equal(resolved.name, `Digital outputs · 0V · ${side} terminal ${index + 1}`);
      assert.doesNotMatch(`${resolved.label} ${resolved.name} ${p.group}`, /common/i, 'the compatibility ID is not shown as a shared connector');
    });
  }
  assert.equal(new Set(terminals.map(p => ports[`dq:${p.id}`].name)).size, 8);
});

test('0V arrow targets align with the eight source circles and exclude the bottom supply row', () => {
  const type = MODULE_TYPES.DQ, scale = 480 / 486;
  const source = readFileSync(new URL('../dist/assets/module-dq.svg', import.meta.url), 'utf8');
  assert.match(source, /viewBox="0 0 88 486"/);
  const circles = [...source.matchAll(/<circle\b([^>]*)>/g)].map(match =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]))
  ).filter(circle => Number(circle.r) === 8.55);
  for (const side of ['left', 'right']) {
    const sourceX = side === 'left' ? 45 : 64;
    close(side === 'left' ? type.body.terminalLeft : type.body.terminalRight, type.body.x + sourceX * scale,
      'arrow X targets remain at the source circle centers');
    zeroPorts().filter(p => p.side === side).forEach((p, index) => {
      const sourceY = [387, 406, 425, 444][index];
      assert.ok(circles.some(circle => Number(circle.cx) === sourceX && Number(circle.cy) === sourceY),
        `${p.id} targets a real terminal circle in the supplied artwork`);
      close(p.pinY, sourceY * scale, `${p.id} arrow targets the center of its physical terminal`);
    });
    assert.ok(circles.some(circle => Number(circle.cx) === sourceX && Number(circle.cy) === 463), 'the bottom supply terminal remains in the artwork');
  }
  assert.ok(type.ports.every(p => Math.abs(p.pinY - 463 * scale) > 1), 'bottom supply terminals are not repurposed as 0V return connections');
  const legacy = type.ports.find(p => p.id === 'common-0v');
  assert.deepEqual([legacy.side, legacy.x, legacy.y], ['left', 60, 430], 'legacy outer wire anchors do not move');
  close(legacy.pinY, 425 * scale, 'the legacy connector now points precisely to the third-left circle');
});

test('the existing eight positive outputs retain IDs, channels, grid anchors, and image targets', () => {
  const positive = MODULE_TYPES.DQ.ports.filter(p => p.signal === '+');
  assert.equal(positive.length, 8);
  for (const side of ['left', 'right']) {
    const terminals = positive.filter(p => p.side === side), offset = side === 'left' ? 0 : 1;
    assert.equal(terminals.length, 4);
    terminals.forEach((p, index) => {
      const channel = index * 2 + offset;
      assert.deepEqual([p.id, p.label, p.channel, p.x, p.y],
        [`ch${channel}-plus`, `CH${channel} +`, channel, side === 'left' ? 60 : 300, 310 + index * 20]);
      close(p.pinY, [312, 330, 349, 368][index] * 480 / 486, 'positive callouts retain their original image targets');
    });
  }
});

test('every 0V terminal rejects double occupancy regardless of imported wire direction', () => {
  const nodes = [dq(), cable()];
  for (const terminal of zeroPorts()) for (const reverse of [false, true]) {
    const target = `dq:${terminal.id}`;
    const second = reverse ? wire('second', target, 'cable:white') : wire('second', 'cable:white', target);
    assert.throws(() => normalize(project(nodes, [wire('first', 'cable:black', target), second])),
      /terminal is connected more than once/, `${terminal.id} remains independently occupied`);
  }
});

test('eight different leads can use all 0V terminals together and retain distinct routed endpoints', () => {
  const terminals = zeroPorts();
  const nodes = [dq(), ...terminals.map((p, index) => cable({
    id: `cable-${index}`, x: p.side === 'left' ? 0 : 1000, y: 80 + index % 4 * 110,
    wireSide: p.side === 'left' ? 'right' : 'left',
  }))];
  const wires = terminals.map((p, index) => index % 2
    ? wire(`return-${index}`, `dq:${p.id}`, `cable-${index}:black`)
    : wire(`return-${index}`, `cable-${index}:black`, `dq:${p.id}`));
  const input = normalize(project(nodes, wires)), geo = geometry(input.nodes, MODULE_TYPES);
  assert.equal(input.wires.length, 8);
  for (const w of input.wires) {
    assert.equal(compatiblePorts(geo.ports[w.from], geo.ports[w.to]), true);
    assert.match(w.from, /^cable-\d:black$/);
  }
  const routed = routeWithPreferences({ ...geo, wires: input.wires, autoRoute: false });
  assert.equal(routed.diagnostics.blocked, 0);
  assert.equal(routed.diagnostics.routed, 8);
  assert.equal(routed.diagnostics.sharedSegments, 0, 'different return wires retain separate lanes');
  for (const w of input.wires) {
    const points = routed.routes[w.id].points, target = geo.ports[w.to];
    assert.deepEqual(points.at(-1), { x: target.x, y: target.y });
    assert.equal(points.at(-2).y, target.y);
    assert.ok(target.side === 'left' ? points.at(-2).x < target.x : points.at(-2).x > target.x,
      'each return approaches its own terminal from the label side');
    w.savedRoute = routed.savedRoutes[w.id];
  }
  const reopened = normalize(copy(input));
  assert.deepEqual(reopened, input);
  const restored = routeWithPreferences({ ...geometry(reopened.nodes, MODULE_TYPES), wires: reopened.wires, preserveRoutes: true });
  for (const w of reopened.wires) assert.deepEqual(restored.routes[w.id].points, routed.routes[w.id].points);
});

test('legacy common-0v projects keep their saved and manual paths through reopen and reversed imports', () => {
  const nodes = [dq({ x: 500 }), cable()];
  // These are the saved coordinates from the original single-common-0V layout.
  const legacyRoute = {
    from: { x: 210, y: 430, side: 'right' }, to: { x: 560, y: 430, side: 'left' },
    points: [{ x: 210, y: 430 }, { x: 300, y: 430 }, { x: 300, y: 510 },
      { x: 480, y: 510 }, { x: 480, y: 430 }, { x: 560, y: 430 }],
  };
  for (const manual of [false, true]) for (const reverse of [false, true]) {
    const stored = reverse ? { points: legacyRoute.points.slice().reverse(), from: legacyRoute.to, to: legacyRoute.from } : legacyRoute;
    const oldWire = wire('legacy', reverse ? 'dq:common-0v' : 'cable:black', reverse ? 'cable:black' : 'dq:common-0v',
      { savedRoute: stored, ...(manual ? { manual: stored } : {}) });
    const opened = normalize(project(nodes, [oldWire]));
    assert.equal(opened.wires[0].from, 'cable:black');
    assert.equal(opened.wires[0].to, 'dq:common-0v');
    assert.deepEqual(opened.wires[0].savedRoute, legacyRoute);
    if (manual) assert.deepEqual(opened.wires[0].manual, legacyRoute);
    const reopened = normalize(copy(opened));
    assert.deepEqual(reopened, opened);
    const routed = routeWithPreferences({ ...geometry(reopened.nodes, MODULE_TYPES), wires: reopened.wires, autoRoute: true, preserveRoutes: true });
    assert.equal(routed.diagnostics.blocked, 0);
    assert.equal(routed.diagnostics.visited, 0, 'adding individual returns does not re-search legacy wire paths');
    assert.deepEqual(routed.routes.legacy.points, legacyRoute.points);
    assert.deepEqual(routed.savedRoutes.legacy, legacyRoute);
  }
});
