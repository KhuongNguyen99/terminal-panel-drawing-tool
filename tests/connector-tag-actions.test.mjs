import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { TAG_WIDTH, TAG_HEIGHT, tagWidth, tagHeight, geometry, matchingTags, normalizeProject } from '../dist/model.js';
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

test('resized tag placement leaves clearance around the whole requested footprint', () => {
  const desired = { x: 0, y: 0 };
  const cases = [
    { width: '320', height: 40, nodes: [device({ x: 250, y: 0 })] },
    { width: 160, height: '120', nodes: [device({ x: 0, y: 100 })] },
  ];
  for (const options of cases) {
    const input = { types: MODULE_TYPES, desired, ...options };
    const before = copy(input);
    freeze(input);
    assert.deepEqual(findConnectorTagPosition({ ...input, width: undefined, height: undefined }), desired,
      'the default-size tag fits at this position');
    const position = findConnectorTagPosition(input);
    assert.ok(position);
    assert.notDeepEqual(position, desired, 'the larger tag must move away from the neighboring label');
    const obstacle = geometry(options.nodes, MODULE_TYPES).obstacles[0];
    assert.ok(position.x + tagWidth(options) + 20 < obstacle.x || position.x - 20 > obstacle.x + obstacle.width ||
      position.y + tagHeight(options) + 20 < obstacle.y || position.y - 20 > obstacle.y + obstacle.height,
    'the resized tag, including its margin, clears the neighboring label');
    assert.deepEqual(input, before, 'placement does not alter the requested size or existing label');
  }
  const narrow = { types: MODULE_TYPES, desired, nodes: [device({ x: 130, y: 0 })], width: 80, height: 30 };
  assert.deepEqual(findConnectorTagPosition(narrow), desired, 'a smaller tag can use space that a default tag cannot');
  assert.notDeepEqual(findConnectorTagPosition({ ...narrow, width: undefined, height: undefined }), desired);
  assert.deepEqual(findConnectorTagPosition({ ...narrow, width: -1, height: 0 }), desired, 'invalid small sizes clamp to the minimum footprint');
  assert.deepEqual(findConnectorTagPosition({ ...narrow, width: Infinity, height: 'invalid' }),
    findConnectorTagPosition({ ...narrow, width: undefined, height: undefined }), 'non-finite sizes use the default footprint');
  const large = { id: 'large', kind: 'tag', name: 'NET1', width: 1000, height: 600, x: 0, y: 0 };
  const besideLarge = findConnectorTagPosition({ nodes: [large], types: MODULE_TYPES, desired, width: 1000, height: 600 });
  assert.ok(besideLarge, 'the bounded search can place a maximum-sized duplicate beside its source');
  assert.ok(besideLarge.x + 1020 < 0 || besideLarge.x - 20 > 1000 || besideLarge.y + 620 < 0 || besideLarge.y - 20 > 600);
});

test('resized tag placement avoids wires beyond the default label bounds', () => {
  const desired = { x: 0, y: 0 };
  for (const options of [
    { width: 320, height: 40, points: [{ x: 250, y: -500 }, { x: 250, y: 500 }] },
    { width: 160, height: 120, points: [{ x: -500, y: 100 }, { x: 500, y: 100 }] },
  ]) {
    const routes = freeze({ wire: { points: options.points } });
    const input = { nodes: [], types: MODULE_TYPES, desired, routes };
    assert.deepEqual(findConnectorTagPosition(input), desired);
    const position = findConnectorTagPosition({ ...input, width: options.width, height: options.height });
    assert.ok(position);
    assert.notDeepEqual(position, desired, 'the whole resized label must avoid the visible wire');
    const [a, b] = options.points;
    assert.ok(position.x + options.width + 10 < Math.min(a.x, b.x) || position.x - 10 > Math.max(a.x, b.x) ||
      position.y + options.height + 10 < Math.min(a.y, b.y) || position.y - 10 > Math.max(a.y, b.y));
    assert.deepEqual(findConnectorTagPosition({ ...input, width: options.width, height: options.height, ignoreWireIds: ['wire'] }), desired);
  }
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
  assert.deepEqual(result.tags.map(t => [tagWidth(t), tagHeight(t)]), [[160, 40], [160, 40]], 'wire replacement keeps the default tag dimensions');
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

test('resizing any tag edge follows its endpoint and preserves manual bends and unrelated wires', () => {
  const cases = {
    left: { device: { x: 0, y: 300, wireSide: 'right' }, manual: [[210, 320], [260, 320], [260, 220], [420, 220], [420, 320], [500, 320]] },
    right: { device: { x: 900, y: 300, wireSide: 'left' }, manual: [[900, 320], [850, 320], [850, 220], [800, 220], [800, 320], [660, 320]] },
    top: { device: { x: 0, y: 140, wireSide: 'right' }, manual: [[210, 160], [300, 160], [300, 80], [580, 80], [580, 300]] },
    bottom: { device: { x: 900, y: 500, wireSide: 'left' }, manual: [[900, 520], [820, 520], [820, 620], [580, 620], [580, 340]] },
  };
  for (const [side, setup] of Object.entries(cases)) for (const manual of [false, true]) for (const [width, height] of [[240, 80], [243, 83]]) {
    const project = normalized([
      device(setup.device),
      { id: 'tag', kind: 'tag', name: 'NET1', wireSide: side, x: 500, y: 300 },
      device({ id: 'unrelated-device', x: 0, y: 900 }),
      { id: 'unrelated-tag', kind: 'tag', name: 'NET2', wireSide: 'left', x: 600, y: 900 },
    ], [wire('resized', 'device:black', 'tag:connector'), wire('unrelated', 'unrelated-device:black', 'unrelated-tag:connector')]);
    const initialGeometry = geometry(project.nodes, MODULE_TYPES);
    const manualPoints = setup.manual.map(([x, y]) => ({ x, y }));
    if (manual) project.wires[0].manual = captureManualRoute(manualPoints, initialGeometry.ports['device:black'], initialGeometry.ports['tag:connector']);
    const baseline = route(project);
    assert.equal(baseline.diagnostics.blocked, 0);
    for (const w of project.wires) w.savedRoute = baseline.savedRoutes[w.id];
    Object.assign(project.nodes.find(n => n.id === 'tag'), { width, height });
    const resizedGeometry = geometry(project.nodes, MODULE_TYPES), resized = route(project);
    const points = resized.routes.resized.points, endpoint = resizedGeometry.ports['tag:connector'];
    assert.equal(resized.diagnostics.blocked, 0, `${side} tag remains routable after resizing`);
    assert.equal(resized.diagnostics.visited, 0, 'resizing adapts fixed routes without rerouting the diagram');
    assert.deepEqual(points[0], baseline.routes.resized.points[0], 'the cable endpoint stays fixed');
    assert.deepEqual(points.at(-1), { x: endpoint.x, y: endpoint.y }, 'the wire follows the resized edge midpoint');
    assert.notDeepEqual(points.at(-1), baseline.routes.resized.points.at(-1));
    assert.deepEqual(resized.routes.unrelated.points, baseline.routes.unrelated.points, 'the unrelated wire does not move');
    if (manual) for (const bend of manualPoints.slice(1, -2)) {
      assert.ok(points.some(p => p.x === bend.x && p.y === bend.y), 'interior manual bends stay where they were placed');
    }
    for (const w of project.wires) w.savedRoute = resized.savedRoutes[w.id];
    const reopened = normalizeProject(copy(project), MODULE_TYPES), restored = route(reopened);
    assert.deepEqual(restored.routes.resized.points, points, 'reopening retains the resized endpoint and wire geometry');
    assert.deepEqual(restored.routes.unrelated.points, baseline.routes.unrelated.points);
  }
});
