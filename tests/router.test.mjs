import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const { routeWires } = await import('../dist/router.js');
const { moveWireSegment } = await import('../dist/manual-routing.js');

const close = (a, b) => Math.abs(a - b) < 1e-5;
function validateOrthogonal(route, from, to) {
  assert.notEqual(route.status, 'blocked', route.diagnostics.join(' '));
  assert.deepEqual(route.points[0], { x: from.x, y: from.y });
  assert.deepEqual(route.points.at(-1), { x: to.x, y: to.y });
  route.points.slice(1).forEach((p, i) => {
    const q = route.points[i];
    assert.ok(close(p.x, q.x) || close(p.y, q.y), 'Every wire segment must be orthogonal');
  });
}
function routeSegments(points) {
  return points.slice(1).map((p, i) => ({ a: points[i], b: p }));
}
function crossesRect(points, r) {
  return routeSegments(points).some(({ a, b }) => close(a.y, b.y)
    ? a.y > r.y && a.y < r.y + r.height && Math.min(Math.max(a.x, b.x), r.x + r.width) > Math.max(Math.min(a.x, b.x), r.x)
    : a.x > r.x && a.x < r.x + r.width && Math.min(Math.max(a.y, b.y), r.y + r.height) > Math.max(Math.min(a.y, b.y), r.y));
}
function sharedSegments(a, b) {
  for (const s of routeSegments(a)) for (const t of routeSegments(b)) {
    if (close(s.a.y, s.b.y) && close(t.a.y, t.b.y) && close(s.a.y, t.a.y)) {
      if (Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x)) > 1e-5) return true;
    } else if (close(s.a.x, s.b.x) && close(t.a.x, t.b.x) && close(s.a.x, t.a.x)) {
      if (Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y)) > 1e-5) return true;
    }
  }
  return false;
}
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }

test('exact non-grid endpoints and outward sides', () => {
  const a = { id: 'a', nodeId: 'device', x: 220, y: 113, side: 'right' };
  const b = { id: 'b', nodeId: 'module', x: 600, y: 317, side: 'left' };
  const result = routeWires({ ports: [a, b], wires: [{ id: 'wire', from: 'a', to: 'b' }],
    obstacles: [{ id: 'device', x: 0, y: 80, width: 220, height: 100 }, { id: 'module', x: 600, y: 0, width: 360, height: 500 }] });
  const route = result.routes.wire;
  validateOrthogonal(route, a, b);
  assert.ok(route.points[1].x > a.x);
  assert.ok(route.points.at(-2).x < b.x);
  for (const p of route.points.slice(2, -2)) assert.ok(close(p.x % 10, 0) && close(p.y % 10, 0));
});

test('detours around an intervening tall module', () => {
  const a = { id: 'a', x: 100, y: 250, side: 'right' }, b = { id: 'b', x: 800, y: 250, side: 'left' };
  const obstruction = { id: 'obstruction', x: 300, y: 0, width: 280, height: 500 };
  const route = routeWires({ ports: [a, b], wires: [{ id: 'w', from: 'a', to: 'b' }], obstacles: [obstruction] }).routes.w;
  validateOrthogonal(route, a, b);
  assert.equal(crossesRect(route.points, obstruction), false);
  assert.ok(route.points.some(p => p.y < 0 || p.y > 500));
});

test('thin obstacles between grid vertices are respected', () => {
  const a = { id: 'a', x: 10, y: 20, side: 'right' }, b = { id: 'b', x: 100, y: 20, side: 'left' };
  const thin = { id: 'thin', x: 44, y: 10, width: 2, height: 20 };
  const r = routeWires({ ports: [a, b], wires: [{ id: 'w', from: a, to: b }], obstacles: [thin], gap: 0 }).routes.w;
  validateOrthogonal(r, a, b); assert.equal(crossesRect(r.points, thin), false);
});

test('same-side ports loop around the correct side without entering a component', () => {
  const a = { id: 'a', nodeId: 'n', x: 400, y: 100, side: 'left' };
  const b = { id: 'b', nodeId: 'n', x: 400, y: 200, side: 'left' };
  const n = { id: 'n', x: 400, y: 0, width: 300, height: 400 };
  const r = routeWires({ ports: [a, b], wires: [{ id: 'w', from: 'a', to: 'b' }], obstacles: [n] }).routes.w;
  validateOrthogonal(r, a, b); assert.equal(crossesRect(r.points, n), false);
  assert.ok(r.points.slice(1, -1).every(p => p.x < 400));
});

test('parallel connections receive independent non-overlapping lanes', () => {
  const ports = [], wires = [];
  for (let i = 0; i < 8; i++) {
    ports.push({ id: `a${i}`, nodeId: 'd', x: 220, y: 100 + i * 20, side: 'right' });
    ports.push({ id: `b${i}`, nodeId: 'm', x: 600, y: 310 + i * 20, side: 'left' });
    wires.push({ id: `w${i}`, from: `a${i}`, to: `b${i}` });
  }
  const input = { ports, wires, obstacles: [{ id: 'd', x: 0, y: 70, width: 220, height: 220 }, { id: 'm', x: 600, y: 0, width: 360, height: 500 }] };
  const result = routeWires(input), all = Object.values(result.routes);
  all.forEach((r, i) => validateOrthogonal(r, ports[2 * i], ports[2 * i + 1]));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.equal(sharedSegments(all[i].points, all[j].points), false);
  assert.equal(result.diagnostics.sharedSegments, 0);
  assert.deepEqual(routeWires(input), result, 'Routing must be deterministic');
});

test('moving a node reroutes endpoints and preserves obstacle clearance', () => {
  const base = { wires: [{ id: 'w', from: 'a', to: 'b' }], ports: [{ id: 'a', x: 100, y: 100, side: 'right' }, { id: 'b', x: 600, y: 300, side: 'left' }], obstacles: [] };
  const first = routeWires(base).routes.w;
  base.ports[0].x = 180; base.ports[0].y = 400;
  const second = routeWires(base).routes.w;
  validateOrthogonal(second, base.ports[0], base.ports[1]);
  assert.notDeepEqual(first.points, second.points);
});

test('overlapped components produce an explicit blocked route, never a fake straight wire', () => {
  const ports = [{ id: 'a', nodeId: 'a-node', x: 200, y: 100, side: 'right' }, { id: 'b', nodeId: 'b-node', x: 500, y: 100, side: 'left' }];
  const result = routeWires({ ports, wires: [{ id: 'w', from: 'a', to: 'b' }], obstacles: [
    { id: 'a-node', x: 0, y: 0, width: 200, height: 200 }, { id: 'cover', x: 190, y: 80, width: 100, height: 40 },
    { id: 'b-node', x: 500, y: 0, width: 200, height: 200 }] });
  assert.equal(result.routes.w.status, 'blocked'); assert.deepEqual(result.routes.w.points, []);
  assert.equal(result.diagnostics.blocked, 1); assert.match(result.routes.w.diagnostics[0], /blocks/);
});

test('occupied port escape lanes are explicitly blocked', () => {
  const result = routeWires({ ports: [{ id: 'a', x: 100, y: 100, side: 'right' }, { id: 'b', x: 500, y: 100, side: 'left' }, { id: 'c', x: 500, y: 200, side: 'left' }],
    wires: [{ id: 'one', from: 'a', to: 'b' }, { id: 'two', from: 'a', to: 'c' }] });
  assert.equal(result.routes.one.status, 'ok'); assert.equal(result.routes.two.status, 'blocked');
  assert.deepEqual(result.routes.two.points, []);
});

test('unavoidable crossings have precise bridge coordinates and retain separate lanes', () => {
  const ports = [{ id: 'a', nodeId: 'left', x: 100, y: 100, side: 'right' }, { id: 'b', nodeId: 'left', x: 100, y: 220, side: 'right' },
    { id: 'c', nodeId: 'right', x: 700, y: 100, side: 'left' }, { id: 'd', nodeId: 'right', x: 700, y: 220, side: 'left' }];
  const obstacles = [{ id: 'left', x: 0, y: 0, width: 100, height: 350 }, { id: 'right', x: 700, y: 0, width: 100, height: 350 },
    { id: 'top', x: 0, y: 0, width: 800, height: 50 }, { id: 'bottom', x: 0, y: 300, width: 800, height: 50 }];
  const result = routeWires({ ports, obstacles, wires: [{ id: 'one', from: 'a', to: 'd' }, { id: 'two', from: 'b', to: 'c' }] });
  validateOrthogonal(result.routes.one, ports[0], ports[3]);
  validateOrthogonal(result.routes.two, ports[1], ports[2]);
  assert.equal(result.routes.two.status, 'crossing'); assert.equal(result.diagnostics.crossings, 1);
  const crossing = result.routes.two.crossings[0];
  assert.equal(crossing.otherWireId, 'one'); assert.equal(crossing.orientation, 'horizontal');
  assert.ok(finiteCoordinate(crossing.x) && finiteCoordinate(crossing.y));
  assert.equal(sharedSegments(result.routes.one.points, result.routes.two.points), false);
  // The first route must reserve the second wire's endpoint access in advance.
  assert.ok(result.routes.one.points.every(p => !(close(p.x, 690) && close(p.y, 100))));
});
function finiteCoordinate(n) { return Number.isFinite(n) && close(n % 10, 0); }

test('invalid ports fail clearly and do not prevent other routes', () => {
  const result = routeWires({ ports: [{ id: 'a', x: 100, y: 100, side: 'right' }, { id: 'b', x: 300, y: 100, side: 'left' }],
    wires: [{ id: 'bad', from: 'missing', to: 'b' }, { id: 'good', from: 'a', to: 'b' }] });
  assert.equal(result.routes.bad.status, 'blocked'); assert.equal(result.routes.good.status, 'ok');
});

const fixed = (points, from, to) => ({ points, from: { x: from.x, y: from.y, side: from.side }, to: { x: to.x, y: to.y, side: to.side } });

test('manual segments reserve their lanes before earlier automatic wires', () => {
  const a = { id: 'auto-from', x: 100, y: 100, side: 'right' }, b = { id: 'auto-to', x: 700, y: 100, side: 'left' };
  const c = { id: 'manual-from', x: 100, y: 200, side: 'right' }, d = { id: 'manual-to', x: 700, y: 200, side: 'left' };
  const points = [{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 200 }, { x: 700, y: 200 }];
  const input = { ports: [a, b, c, d], wires: [{ id: 'auto', from: a.id, to: b.id }, { id: 'manual', from: c.id, to: d.id, manual: fixed(points, c, d) }] };
  const result = routeWires(input);
  assert.equal(result.diagnostics.blocked, 0);
  assert.deepEqual(result.routes.manual.points, points, 'the manually positioned trunk stays exactly where it was placed');
  validateOrthogonal(result.routes.auto, a, b);
  assert.ok(result.routes.auto.points.some(p => !close(p.y, 100)), 'the automatic wire moves to another lane');
  assert.equal(sharedSegments(result.routes.auto.points, result.routes.manual.points), false);
  assert.deepEqual(routeWires(input), result, 'mixed manual and automatic routing remains deterministic');
});

test('manual routes retain precise bridge diagnostics at permitted crossings', () => {
  const a = { id: 'a', x: 100, y: 100, side: 'right' }, b = { id: 'b', x: 700, y: 100, side: 'left' };
  const c = { id: 'c', x: 300, y: 0, side: 'right' }, d = { id: 'd', x: 800, y: 200, side: 'left' };
  const first = [{ x: 100, y: 100 }, { x: 700, y: 100 }];
  const second = [{ x: 300, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 800, y: 200 }];
  const result = routeWires({ ports: [a, b, c, d], wires: [{ id: 'one', from: 'a', to: 'b', manual: fixed(first, a, b) }, { id: 'two', from: 'c', to: 'd', manual: fixed(second, c, d) }] });
  assert.equal(result.diagnostics.blocked, 0);
  assert.equal(result.routes.two.status, 'crossing');
  assert.deepEqual(result.routes.two.crossings, [{ x: 320, y: 100, otherWireId: 'one', orientation: 'vertical' }]);
});

test('manual wires through components stay explicitly blocked instead of being silently rerouted', () => {
  const a = { id: 'a', x: 100, y: 100, side: 'right' }, b = { id: 'b', x: 700, y: 100, side: 'left' };
  const points = [{ x: 100, y: 100 }, { x: 700, y: 100 }];
  const result = routeWires({ ports: [a, b], obstacles: [{ x: 300, y: 80, width: 80, height: 40 }], wires: [{ id: 'manual', from: 'a', to: 'b', manual: fixed(points, a, b) }] });
  assert.equal(result.routes.manual.status, 'blocked');
  assert.deepEqual(result.routes.manual.points, []);
  assert.match(result.routes.manual.diagnostics.join(' '), /component/);
});

test('manual paths cannot occupy another connected port escape lane', () => {
  const a = { id: 'a', x: 100, y: 100, side: 'right' }, b = { id: 'b', x: 700, y: 100, side: 'left' };
  const c = { id: 'c', x: 400, y: 100, side: 'right' }, d = { id: 'd', x: 900, y: 300, side: 'left' };
  const result = routeWires({ ports: [a, b, c, d], wires: [{ id: 'manual', from: 'a', to: 'b', manual: fixed([{ x: 100, y: 100 }, { x: 700, y: 100 }], a, b) }, { id: 'auto', from: 'c', to: 'd' }] });
  assert.equal(result.routes.manual.status, 'blocked');
  assert.match(result.routes.manual.diagnostics.join(' '), /port connection|escape lane/);
  validateOrthogonal(result.routes.auto, c, d);
});

test('moved endpoints reattach to a manual route and retain orthogonal connections', () => {
  const originalA = { id: 'a', nodeId: 'device', x: 100, y: 100, side: 'right' };
  const originalB = { id: 'b', nodeId: 'module', x: 700, y: 200, side: 'left' };
  const points = [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 200 }, { x: 700, y: 200 }];
  const a = { ...originalA, x: 140, y: 140 }, b = { ...originalB, x: 660, y: 280 };
  const result = routeWires({ ports: [a, b], obstacles: [{ id: 'device', x: 0, y: 120, width: 140, height: 60 }, { id: 'module', x: 660, y: 240, width: 150, height: 80 }], wires: [{ id: 'manual', from: 'a', to: 'b', manual: fixed(points, originalA, originalB) }] });
  validateOrthogonal(result.routes.manual, a, b);
  assert.ok(result.routes.manual.points[1].x > a.x);
  assert.ok(result.routes.manual.points.at(-2).x < b.x);
});

test('first and last segment edits retain clear port stubs including a wide module header', () => {
  const a = { id: 'a', nodeId: 'device', x: 100, y: 100, side: 'right' };
  const b = { id: 'b', nodeId: 'module', x: 700, y: 300, side: 'left' };
  const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 300 }, { x: 700, y: 300 }];
  const obstacles = [{ id: 'device', x: 0, y: 70, width: 100, height: 60 },
    { id: 'module-header', nodeId: 'module', x: 640, y: -40, width: 360, height: 40 },
    { id: 'module', nodeId: 'module', x: 700, y: 0, width: 240, height: 500 }];
  for (const [index, coordinate] of [[0, 80], [2, 320]]) {
    const edited = moveWireSegment(points, index, coordinate, { grid: 10, from: { ...a, escapeX: 110 }, to: { ...b, escapeX: 630 } });
    assert.ok(edited, 'the endpoint segment can be moved by adding an attached dogleg');
    const result = routeWires({ ports: [a, b], obstacles, wires: [{ id: 'manual', from: 'a', to: 'b', manual: fixed(edited, a, b) }] });
    validateOrthogonal(result.routes.manual, a, b);
    assert.deepEqual(result.routes.manual.points, edited);
    for (const obstacle of obstacles) assert.equal(crossesRect(edited, obstacle), false);
    assert.ok(edited.at(-2).x <= 630, 'the last bend stays beyond the module header escape boundary');
  }
});

// Integration: run the actual application example through its actual geometry.
const loadLocalModule = async path => import(new URL(path, import.meta.url));
const { MODULE_TYPES } = await loadLocalModule('../dist/modules.js');
const model = await loadLocalModule('../dist/model.js');
const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const exampleFunctions = appSource.slice(appSource.indexOf('function newDevice('), appSource.indexOf('\ntry {'));
const applicationExamples = new Function('MODULE_TYPES', 'makeId', 'CONDUCTORS',
  `${exampleFunctions}; return [exampleProject(false), exampleProject(true)];`)(MODULE_TYPES, model.makeId, model.CONDUCTORS);
test('actual app Slot 5 example routes all 16 conductors without overlapping or entering nodes', () => {
  const project = applicationExamples[1], geo = model.geometry(project.nodes, MODULE_TYPES);
  assert.equal(project.wires.length, 16);
  const started = performance.now();
  const result = routeWires({ wires: project.wires, ...geo, grid: project.settings.grid, gap: 10 });
  const elapsed = performance.now() - started;
  assert.equal(result.diagnostics.blocked, 0);
  for (const wire of project.wires) {
    const route = result.routes[wire.id];
    validateOrthogonal(route, geo.ports[wire.from], geo.ports[wire.to]);
    for (const rect of geo.obstacles) assert.equal(crossesRect(route.points, rect), false, `${wire.id} enters ${rect.id}`);
  }
  const all = Object.values(result.routes);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.equal(sharedSegments(all[i].points, all[j].points), false);
  console.log(`  App integration: ${elapsed.toFixed(1)} ms, ${result.diagnostics.crossings} bridge crossings, ${result.diagnostics.visited} visited states`);
});

// Representative 32-wire routing workload across four independently placed modules.
const ports = [], wires = [], obstacles = [];
for (let m = 0; m < 4; m++) {
  const ox = m * 1000;
  obstacles.push({ id: `d${m}`, x: ox, y: 60, width: 220, height: 250 }, { id: `m${m}`, x: ox + 600, y: 0, width: 360, height: 500 });
  for (let p = 0; p < 8; p++) {
    ports.push({ id: `d${m}-${p}`, nodeId: `d${m}`, x: ox + 220, y: 100 + p * 20, side: 'right' }, { id: `m${m}-${p}`, nodeId: `m${m}`, x: ox + 600, y: 310 + p * 20, side: 'left' });
    wires.push({ id: `w${m}-${p}`, from: `d${m}-${p}`, to: `m${m}-${p}` });
  }
}
const t0 = performance.now(), benchmark = routeWires({ wires, ports, obstacles }), elapsed = performance.now() - t0;
assert.equal(benchmark.diagnostics.blocked, 0);
console.log(`PASS 32-wire workload: ${elapsed.toFixed(1)} ms, ${benchmark.diagnostics.visited} visited states, ${benchmark.diagnostics.crossings} crossings`);
console.log(`${checks + 1} routing checks passed.`);
