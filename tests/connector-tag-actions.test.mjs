import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { TAG_WIDTH, TAG_HEIGHT, geometry, matchingTags, normalizeProject } from '../dist/model.js';
import { captureManualRoute } from '../dist/manual-routing.js';
import { routeWithPreferences } from '../dist/independent-routing.js';
import { findConnectorTagPosition, replaceWireWithTags } from '../dist/connector-tag-actions.js';

const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const normalized = (nodes, wires) => normalizeProject({ version: 1, title: 'Connector tag actions', nodes, wires,
  settings: { grid: 10, snap: true, defaultWidth: 2.5, autoRoute: false } }, MODULE_TYPES);
const device = (extra = {}) => ({ id: 'device', kind: 'device', name: 'Sensor', wireCount: 2, wireSide: 'right', x: 0, y: 300, ...extra });
const module = (extra = {}) => ({ id: 'module', kind: 'module', type: 'AI', x: 900, y: 0, ...extra });
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#1267ab', width: 4, ...extra });
const route = project => routeWithPreferences({ ...geometry(project.nodes, MODULE_TYPES), wires: project.wires,
  grid: project.settings.grid, autoRoute: false, preserveRoutes: true });
const fixture = () => normalized([device(), module()], [wire('selected', 'device:black', 'module:ch0-minus'), wire('neighbor', 'device:white', 'module:ch0-plus')]);

test('tag placement snaps near the requested position and respects node and visible wire clearances', () => {
  assert.deepEqual(findConnectorTagPosition({ nodes: [], types: MODULE_TYPES, desired: { x: 123, y: 87 } }), { x: 120, y: 90 });
  assert.deepEqual(findConnectorTagPosition({ nodes: [], types: MODULE_TYPES, desired: { x: 123.25, y: 87.5 }, snapToGrid: false }), { x: 123.25, y: 87.5 });
  assert.equal(findConnectorTagPosition({ nodes: [], types: MODULE_TYPES, desired: { x: NaN, y: 0 } }), null);
  const nodes = [device({ x: 0, y: 0 })];
  const routes = { visible: { status: 'blocked', points: [{ x: 240, y: -500 }, { x: 240, y: 500 }] } };
  const before = copy({ nodes, routes });
  freeze(nodes); freeze(routes);
  const position = findConnectorTagPosition({ nodes, types: MODULE_TYPES, desired: { x: 0, y: 0 }, routes });
  assert.ok(position);
  const box = { left: position.x, right: position.x + TAG_WIDTH, top: position.y, bottom: position.y + TAG_HEIGHT };
  assert.ok(box.right + 20 < 0 || box.left - 20 > 210 || box.bottom + 20 < 0 || box.top - 20 > 60);
  assert.ok(box.right + 10 < 240 || box.left - 10 > 240 || box.bottom + 10 < -500 || box.top - 10 > 500);
  assert.deepEqual({ nodes, routes }, before, 'search does not move nodes or wires');
  const desired = { x: 220, y: 0 };
  assert.notDeepEqual(findConnectorTagPosition({ nodes: [], types: MODULE_TYPES, desired, routes }), desired);
  assert.deepEqual(findConnectorTagPosition({ nodes: [], types: MODULE_TYPES, desired, routes, ignoreWireIds: ['visible'] }), desired);
});

test('tag placement has a bounded search and reports a fully occupied area', () => {
  const types = { COVER: { routingObstacles: [{ x: -2000, y: -2000, width: 4000, height: 4000 }], ports: [] } };
  const nodes = [{ id: 'cover', kind: 'module', type: 'COVER', x: 0, y: 0 }];
  assert.equal(findConnectorTagPosition({ nodes, types, desired: { x: 0, y: 0 } }), null);
});

test('conversion creates a matching pair, keeps wire styling and manual neighbors, and survives save/reopen', () => {
  const project = fixture();
  project.nodes.push({ id: 'existing-tag', kind: 'tag', name: 'net1', wireSide: 'right', x: -500, y: 0 });
  const geo = geometry(project.nodes, MODULE_TYPES);
  const initial = route(project);
  const neighbor = project.wires.find(w => w.id === 'neighbor');
  neighbor.manual = captureManualRoute(initial.routes.neighbor.points, geo.ports[neighbor.from], geo.ports[neighbor.to]);
  const baseline = route(project);
  const projectBefore = copy(project), routesBefore = copy(baseline);
  freeze(project); freeze(baseline);
  const result = replaceWireWithTags(project, 'selected', MODULE_TYPES, baseline);
  assert.deepEqual(project, projectBefore);
  assert.deepEqual(copy(baseline), routesBefore);
  assert.equal(result.project.nodes.length, project.nodes.length + 2);
  assert.equal(result.project.wires.length, project.wires.length + 1);
  assert.equal(result.project.wires.some(w => w.id === 'selected'), false);
  assert.deepEqual(result.tags.map(t => [t.name, t.wireSide]), [['NET2', 'left'], ['NET2', 'right']]);
  assert.deepEqual(matchingTags(result.project.nodes, result.tags[0]).map(t => t.id), [result.tags[1].id]);
  assert.deepEqual(result.routing.routes.neighbor.points, baseline.routes.neighbor.points);
  assert.deepEqual(result.project.wires.find(w => w.id === 'neighbor').manual, neighbor.manual);
  const additions = result.project.wires.filter(w => w.id !== 'neighbor');
  assert.deepEqual(additions.map(w => w.from), ['device:black', 'module:ch0-minus']);
  assert.deepEqual(additions.map(w => w.to), result.tags.map(t => `${t.id}:connector`));
  for (const addition of additions) {
    assert.equal(addition.color, '#1267ab');
    assert.equal(addition.width, 4);
    assert.notEqual(result.routing.routes[addition.id].status, 'blocked');
    assert.ok(addition.savedRoute);
  }
  const reopened = normalizeProject(copy(result.project), MODULE_TYPES);
  assert.deepEqual(reopened, result.project);
  const reloadedRoutes = route(reopened);
  for (const w of reopened.wires) assert.deepEqual(reloadedRoutes.routes[w.id].points, result.routing.routes[w.id].points);
});

test('conversion derives a baseline when absent and faces tags toward vertical terminal connectors', () => {
  for (const side of ['top', 'bottom']) {
    const project = normalized([
      module({ id: 'rail', type: 'DIN_RESISTOR', x: 1000, y: 400 }),
      module({ x: 0, y: 400 }),
    ], [wire('selected', `rail:${side}-1`, 'module:ch1-minus')]);
    const result = replaceWireWithTags(project, 'selected', MODULE_TYPES, {});
    assert.equal(result.tags[0].wireSide, side === 'top' ? 'bottom' : 'top');
    assert.equal(result.tags[1].wireSide, 'left');
    assert.equal(result.routing.diagnostics.blocked, 0);
    assert.equal(result.project.wires.length, 2);
    assert.deepEqual(normalizeProject(copy(result.project), MODULE_TYPES), result.project);
  }
});

test('conversion rejects tag wires and missing wires without changing the project', () => {
  const project = normalized([device(), { id: 'tag', kind: 'tag', name: 'NET1', wireSide: 'left', x: 400, y: 300 }], [wire('selected', 'device:black', 'tag:connector')]);
  const before = copy(project);
  freeze(project);
  assert.throws(() => replaceWireWithTags(project, 'selected', MODULE_TYPES), /already connects to a connector tag/);
  assert.throws(() => replaceWireWithTags(project, 'missing', MODULE_TYPES), /Select an existing wire/);
  assert.deepEqual(project, before);
});

test('routing conflicts roll back conversion and offer manual tag placement', () => {
  const project = fixture();
  const baseline = route(project);
  project.nodes.push(device({ id: 'obstruction', x: 450, y: 330 }));
  const before = copy(project);
  freeze(project); freeze(baseline);
  assert.throws(() => replaceWireWithTags(project, 'selected', MODULE_TYPES, baseline), /Add connector tags manually/);
  assert.deepEqual(project, before, 'the original wire and all existing items survive a failed conversion');
});

test('conversion guards project limits before creating unsaveable items', () => {
  const project = fixture();
  const nodeLimit = copy(project);
  while (nodeLimit.nodes.length < 499) nodeLimit.nodes.push({ id: `extra-${nodeLimit.nodes.length}`, kind: 'tag' });
  const wireLimit = copy(project);
  while (wireLimit.wires.length < 2000) wireLimit.wires.push({ id: `extra-${wireLimit.wires.length}` });
  for (const oversized of [nodeLimit, wireLimit]) {
    const before = copy(oversized);
    freeze(oversized);
    assert.throws(() => replaceWireWithTags(oversized, 'selected', MODULE_TYPES), /500 items or 2,000 wires/);
    assert.deepEqual(oversized, before);
  }
});
