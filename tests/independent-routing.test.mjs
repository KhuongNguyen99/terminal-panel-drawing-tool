import assert from 'node:assert/strict';
import test from 'node:test';
import { routeWithPreferences } from '../dist/independent-routing.js';
import { captureManualRoute, moveWireSegment } from '../dist/manual-routing.js';
import { createScheduleProject } from '../dist/schedule.js';
import { MODULE_TYPES } from '../dist/modules.js';
import { geometry } from '../dist/model.js';

const copy = value => JSON.parse(JSON.stringify(value));
function rememberRoutes(wires, result) {
  for (const wire of wires) if (result.savedRoutes[wire.id]) wire.savedRoute = result.savedRoutes[wire.id];
}
function pointsExcept(result, exceptions = []) {
  return Object.fromEntries(Object.entries(result.routes).filter(([id]) => !exceptions.includes(id)).map(([id, route]) => [id, route.points]));
}
function scheduleFixture() {
  const project = createScheduleProject();
  const geo = geometry(project.nodes, MODULE_TYPES);
  const first = routeWithPreferences({ ...geo, wires: project.wires });
  rememberRoutes(project.wires, first);
  return { project, geo, first };
}
function editBlackTrunk(project, geo, first) {
  const wire = project.wires.find(w => w.id === 'riob-slot8-ch0-black');
  const points = moveWireSegment(first.routes[wire.id].points, 1, 1780, {
    from: geo.ports[wire.from], to: geo.ports[wire.to], grid: 10,
  });
  wire.manual = captureManualRoute(points, geo.ports[wire.from], geo.ports[wire.to]);
  return wire;
}

test('all 82 populated schedule connections freeze exactly without a new route search', () => {
  const { project, geo, first } = scheduleFixture();
  assert.equal(first.diagnostics.routed, 82);
  assert.equal(first.diagnostics.blocked, 0);
  assert.equal(Object.keys(first.savedRoutes).length, 82);
  const frozen = routeWithPreferences({ ...geo, wires: project.wires });
  assert.equal(frozen.diagnostics.blocked, 0);
  assert.equal(frozen.diagnostics.visited, 0);
  assert.deepEqual(frozen.routes, first.routes, 'points and crossing annotations survive freezing');
});

test('moving one segment keeps every other wire in the full schedule in place', () => {
  const { project, geo, first } = scheduleFixture();
  const wire = editBlackTrunk(project, geo, first);
  const next = routeWithPreferences({ ...geo, wires: project.wires });
  assert.equal(next.diagnostics.blocked, 0);
  assert.notDeepEqual(next.routes[wire.id].points, first.routes[wire.id].points);
  assert.deepEqual(next.routes[wire.id].points, wire.manual.points);
  assert.deepEqual(pointsExcept(next, [wire.id]), pointsExcept(first, [wire.id]));
  assert.equal(next.diagnostics.visited, 0, 'no other connection is searched again');
});

test('an explicit single-wire route changes only that wire even with automatic routing enabled', () => {
  const { project, geo, first } = scheduleFixture();
  const wire = editBlackTrunk(project, geo, first);
  const edited = routeWithPreferences({ ...geo, wires: project.wires });
  rememberRoutes(project.wires, edited);
  const rerouted = routeWithPreferences({ ...geo, wires: project.wires, autoRoute: true, rerouteIds: [wire.id] });
  assert.equal(rerouted.diagnostics.blocked, 0);
  assert.notDeepEqual(rerouted.routes[wire.id].points, edited.routes[wire.id].points);
  assert.deepEqual(rerouted.routes[wire.id].points, first.routes[wire.id].points);
  assert.deepEqual(pointsExcept(rerouted, [wire.id]), pointsExcept(edited, [wire.id]));
  assert.ok(wire.manual, 'policy does not mutate the project while calculating');
});

test('explicitly routing all connections ignores saved bends and manual bends', () => {
  const { project, geo, first } = scheduleFixture();
  editBlackTrunk(project, geo, first);
  rememberRoutes(project.wires, routeWithPreferences({ ...geo, wires: project.wires }));
  const rerouted = routeWithPreferences({ ...geo, wires: project.wires, rerouteAll: true });
  assert.equal(rerouted.diagnostics.blocked, 0);
  assert.deepEqual(rerouted.routes, first.routes);
});

test('moving a device reattaches its wires without moving unrelated wires', () => {
  const { project, geo, first } = scheduleFixture();
  const wire = editBlackTrunk(project, geo, first);
  const edited = routeWithPreferences({ ...geo, wires: project.wires });
  rememberRoutes(project.wires, edited);
  const device = project.nodes.find(n => n.id === 'riob-slot8-ch0');
  device.x += 10;
  const movedGeo = geometry(project.nodes, MODULE_TYPES);
  const moved = routeWithPreferences({ ...movedGeo, wires: project.wires });
  assert.equal(moved.diagnostics.blocked, 0);
  const affected = project.wires.filter(w => w.from.startsWith(`${device.id}:`)).map(w => w.id);
  assert.deepEqual(pointsExcept(moved, affected), pointsExcept(edited, affected));
  assert.deepEqual(moved.routes[wire.id].points[0], { x: movedGeo.ports[wire.from].x, y: movedGeo.ports[wire.from].y });
  assert.deepEqual(moved.routes[wire.id].points.slice(1), edited.routes[wire.id].points.slice(1));
});

test('saving, restoring and export preserve routes even when automatic routing is enabled', () => {
  const { project, geo, first } = scheduleFixture();
  editBlackTrunk(project, geo, first);
  const edited = routeWithPreferences({ ...geo, wires: project.wires });
  rememberRoutes(project.wires, edited);
  const restored = copy(project);
  for (const wire of restored.wires) delete wire.manual; // Saved geometry alone must preserve placement.
  const rendered = routeWithPreferences({ ...geometry(restored.nodes, MODULE_TYPES), wires: restored.wires, autoRoute: true, preserveRoutes: true });
  assert.equal(rendered.diagnostics.blocked, 0);
  assert.deepEqual(pointsExcept(rendered), pointsExcept(edited));
});

function collisionFixture() {
  const ports = [
    { id: 'a', x: 100, y: 100, side: 'right' }, { id: 'b', x: 700, y: 100, side: 'left' },
    { id: 'c', x: 100, y: 200, side: 'right' }, { id: 'd', x: 700, y: 200, side: 'left' },
  ];
  const wires = [{ id: 'one', from: 'a', to: 'b' }, { id: 'two', from: 'c', to: 'd' }];
  const initial = routeWithPreferences({ ports, wires });
  rememberRoutes(wires, initial);
  wires[1].manual = captureManualRoute([
    { x: 100, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 100 },
    { x: 600, y: 100 }, { x: 600, y: 200 }, { x: 700, y: 200 },
  ], ports[2], ports[3]);
  return { ports, wires, initial };
}

test('conflicting segment edits report a blocked lane rather than moving a neighbor', () => {
  const { ports, wires, initial } = collisionFixture();
  const next = routeWithPreferences({ ports, wires });
  assert.deepEqual(next.routes.one.points, initial.routes.one.points);
  assert.equal(next.routes.two.status, 'blocked');
  assert.equal(next.savedRoutes.two, undefined, 'a rejected route cannot overwrite the last good saved geometry');
  const preserved = routeWithPreferences({ ports, wires, autoRoute: true, preserveRoutes: true });
  assert.deepEqual(preserved.routes, next.routes, 'segment commits can preserve neighbors in either mode');
});

test('automatic rerouting is an opt-in that can move generated paths around manual paths', () => {
  const { ports, wires, initial } = collisionFixture();
  const enabled = routeWithPreferences({ ports, wires, autoRoute: true });
  assert.equal(enabled.diagnostics.blocked, 0);
  assert.notDeepEqual(enabled.routes.one.points, initial.routes.one.points);
  assert.deepEqual(enabled.routes.two.points, wires[1].manual.points);
  rememberRoutes(wires, enabled);
  const disabled = routeWithPreferences({ ports, wires });
  assert.equal(disabled.diagnostics.blocked, 0);
  assert.deepEqual(pointsExcept(disabled), pointsExcept(enabled), 'turning automatic routing off freezes the latest layout');
});

test('new wires route once around fixed wires without moving existing connections', () => {
  const { ports, wires, initial } = collisionFixture();
  delete wires[1].manual;
  ports.push({ id: 'e', x: 100, y: 300, side: 'right' }, { id: 'f', x: 700, y: 50, side: 'left' });
  wires.unshift({ id: 'new', from: 'e', to: 'f' });
  const next = routeWithPreferences({ ports, wires });
  assert.equal(next.diagnostics.blocked, 0);
  assert.deepEqual(next.routes.one.points, initial.routes.one.points);
  assert.deepEqual(next.routes.two.points, initial.routes.two.points);
  assert.ok(next.savedRoutes.new);
});

test('a remote dense terminal does not change the grid or path of an unrelated automatic wire', () => {
  const nodes = [
    { id: 'd', kind: 'device', wireCount: 2, wireSide: 'right', x: 0, y: 0 },
    { id: 't', kind: 'tag', wireSide: 'left', x: 2200, y: 2200 },
    { id: 's', kind: 'module', type: 'DIN_TERMINAL', x: 10000, y: 10005 },
    { id: 'ds', kind: 'device', wireCount: 2, wireSide: 'right', x: 9450, y: 10110 },
  ];
  const geo = geometry(nodes, MODULE_TYPES);
  const first = { id: 'first', from: 'd:black', to: 't:connector' };
  const remote = { id: 'remote', from: 'ds:black', to: 's:left-1-middle' };
  for (const grid of [10, 20]) {
    const options = { ...geo, grid, gap: grid, rerouteAll: true };
    const baseline = routeWithPreferences({ ...options, wires: [first] });
    assert.equal(baseline.routes.first.status, 'ok');
    for (const wires of [[first, remote], [remote, first]]) {
      const result = routeWithPreferences({ ...options, wires });
      assert.equal(result.diagnostics.blocked, 0);
      assert.deepEqual(result.routes.first, baseline.routes.first);
      assert.equal(result.routes.first.grid, grid);
      assert.equal(result.routes.remote.grid, 5);
      assert.equal(result.routes.remote.gap, 10);
    }
  }
});

test('a new wire cannot cover a displayed fixed route whose terminal escape is blocked', () => {
  const nodes = [
    { id: 'd', kind: 'device', wireCount: 2, wireSide: 'right', x: 0, y: 0 },
    { id: 't', kind: 'tag', wireSide: 'left', x: 1200, y: 0 },
  ];
  const fixed = { id: 'old', from: 'd:black', to: 't:connector' };
  const before = routeWithPreferences({ ...geometry(nodes, MODULE_TYPES), wires: [fixed] });
  fixed.savedRoute = before.savedRoutes.old;
  nodes.push(
    { id: 'obstruction', kind: 'tag', wireSide: 'left', x: 215, y: 0 },
    { id: 'd2', kind: 'device', wireCount: 2, wireSide: 'right', x: 300, y: 0 },
    { id: 't2', kind: 'tag', wireSide: 'left', x: 800, y: 0 },
  );
  const next = routeWithPreferences({ ...geometry(nodes, MODULE_TYPES), wires: [
    { id: 'new', from: 'd2:black', to: 't2:connector' }, fixed,
  ] });
  assert.equal(next.routes.old.status, 'blocked');
  assert.deepEqual(next.routes.old.points, before.routes.old.points);
  assert.equal(next.routes.new.status, 'blocked', 'its outward stub is occupied by the displayed fixed route');
  assert.deepEqual(next.routes.new.points, []);
});

test('a crowded wire can still use a finer available escape when the placement grid is too coarse', () => {
  const ports = [
    { id: 'a', x: 0, y: 0, side: 'right' }, { id: 'b', x: 240, y: 40, side: 'left' },
    { id: 'c', x: 1400, y: 0, side: 'right' }, { id: 'din', x: 1600, y: 0, side: 'left', routingPitch: 10 },
  ];
  const wires = [{ id: 'ordinary', from: 'a', to: 'b' }, { id: 'terminal', from: 'c', to: 'din' }];
  const input = { ports, wires, grid: 20, gap: 20, obstacles: [{ id: 'near-source', x: 20, y: -6, width: 10, height: 12 }] };
  const first = routeWithPreferences(input);
  assert.equal(first.diagnostics.blocked, 0);
  assert.equal(first.routes.ordinary.grid, 10);
  assert.equal(first.routes.ordinary.gap, 10);
  assert.deepEqual(first.routes.ordinary.points[1], { x: 10, y: 0 }, 'the coarse 20-unit escape hits the obstacle');
  rememberRoutes(wires, first);
  const reopened = routeWithPreferences(input);
  assert.deepEqual(reopened.routes, first.routes);
  assert.equal(reopened.diagnostics.visited, 0);
});

test('moving an unrelated component over a fixed wire preserves its visible geometry and reports the conflict', () => {
  const { ports, wires, initial } = collisionFixture();
  delete wires[1].manual;
  const next = routeWithPreferences({ ports, wires, obstacles: [{ id: 'moved-component', x: 300, y: 80, width: 80, height: 40 }] });
  assert.equal(next.routes.one.status, 'blocked');
  assert.deepEqual(next.routes.one.points, initial.routes.one.points, 'a fixed wire stays in place even when a component obstructs it');
  assert.match(next.routes.one.diagnostics.join(' '), /component/);
  assert.equal(next.savedRoutes.one, undefined, 'conflicting geometry must not replace the last successful route');
  assert.deepEqual(next.routes.two.points, initial.routes.two.points);
  assert.notEqual(next.routes.two.status, 'blocked');
});

test('policy does not mutate frozen input data and supports object and Map port collections', () => {
  const { project, geo, first } = scheduleFixture();
  const before = copy(project.wires);
  const freeze = object => { if (object && typeof object === 'object') { for (const value of Object.values(object)) freeze(value); Object.freeze(object); } return object; };
  freeze(project.wires); freeze(geo);
  const objectPorts = routeWithPreferences({ ...geo, wires: project.wires });
  const mapPorts = routeWithPreferences({ ...geo, ports: new Map(Object.entries(geo.ports)), wires: project.wires });
  assert.deepEqual(project.wires, before);
  assert.deepEqual(objectPorts.routes, first.routes);
  assert.deepEqual(mapPorts.savedRoutes, objectPorts.savedRoutes);
  assert.notEqual(objectPorts.savedRoutes[project.wires[0].id].points, project.wires[0].savedRoute.points);
});
