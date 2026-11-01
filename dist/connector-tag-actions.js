import { TAG_WIDTH, TAG_HEIGHT, clone, compatiblePorts, geometry, makeId, nextTagName, snap } from './model.js';
import { captureManualRoute } from './manual-routing.js';
import { routeWithPreferences } from './independent-routing.js';

const NODE_MARGIN = 20;
const WIRE_MARGIN = 10;
const SEARCH_RADIUS = 10;
const SIDES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const placementError = () => new Error('There is not enough clear space near this wire. Add connector tags manually, or move nearby items and try again.');
const routingError = () => new Error('The short connections cannot be routed without disturbing another wire. Add connector tags manually, or move nearby items and try again.');
const overlaps = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
const rect = (x, y, width, height, margin = 0) => ({ left: x - margin, right: x + width + margin, top: y - margin, bottom: y + height + margin });
const samePoints = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/** Find a nearby top-left position, leaving room around nodes and visible wires. */
export function findConnectorTagPosition({ nodes = [], types, desired, grid = 10, snapToGrid = true, routes = {}, ignoreWireIds = [] }) {
  if (!Number.isFinite(desired?.x) || !Number.isFinite(desired?.y)) return null;
  grid = Number.isFinite(grid) && grid > 0 ? grid : 10;
  const origin = { x: snapToGrid ? snap(desired.x, grid) : desired.x, y: snapToGrid ? snap(desired.y, grid) : desired.y };
  const step = Math.ceil(40 / grid) * grid;
  const obstacles = geometry(nodes, types).obstacles.map(o => rect(o.x, o.y, o.width, o.height));
  const ignored = new Set(ignoreWireIds), wireSegments = [];
  for (const [id, route] of Object.entries(routes.routes || routes)) {
    if (ignored.has(id) || !Array.isArray(route?.points)) continue;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      wireSegments.push({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });
    }
  }
  const candidates = [];
  for (let row = -SEARCH_RADIUS; row <= SEARCH_RADIUS; row++) for (let column = -SEARCH_RADIUS; column <= SEARCH_RADIUS; column++) {
    candidates.push({ x: origin.x + column * step, y: origin.y + row * step, distance: column * column + row * row });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  for (const candidate of candidates) {
    const { x, y } = candidate;
    if (x < -10000 || x > 20000 || y < -10000 || y > 20000) continue;
    const nodeArea = rect(x, y, TAG_WIDTH, TAG_HEIGHT, NODE_MARGIN);
    if (obstacles.some(obstacle => overlaps(nodeArea, obstacle))) continue;
    const wireArea = rect(x, y, TAG_WIDTH, TAG_HEIGHT, WIRE_MARGIN);
    if (wireSegments.some(segment => overlaps(wireArea, segment))) continue;
    return { x, y };
  }
  return null;
}

function tagPlacement(port) {
  const [dx, dy] = SIDES[port.side];
  const wireSide = OPPOSITE[port.side];
  const portX = port.x + dx * 80, portY = port.y + dy * 80;
  const localX = wireSide === 'left' ? 0 : wireSide === 'right' ? TAG_WIDTH : TAG_WIDTH / 2;
  const localY = wireSide === 'top' ? 0 : wireSide === 'bottom' ? TAG_HEIGHT : TAG_HEIGHT / 2;
  return { wireSide, desired: { x: portX - localX, y: portY - localY } };
}

/** Build an atomic replacement; callers may commit it to history only on success. */
export function replaceWireWithTags(project, wireId, types, currentRouting) {
  const original = project.wires.find(w => w.id === wireId);
  if (!original) throw new Error('Select an existing wire to replace with connector tags.');
  if (project.nodes.length + 2 > 500 || project.wires.length + 1 > 2000) {
    throw new Error('This conversion would exceed the project limit of 500 items or 2,000 wires. Remove unused items or wires before adding connector tags.');
  }
  const originalGeometry = geometry(project.nodes, types);
  const endpoints = [originalGeometry.ports[original.from], originalGeometry.ports[original.to]];
  if (endpoints.some(p => p?.kind === 'tag')) throw new Error('This wire already connects to a connector tag. Add or rename tags manually instead.');
  if (endpoints.some(p => !p || !['device', 'module'].includes(p.kind) || !SIDES[p.side]) || !compatiblePorts(...endpoints)) {
    throw new Error('This wire has missing or incompatible endpoints. Add connector tags manually instead.');
  }
  const grid = project.settings?.grid || 10, gap = Math.max(10, grid);
  const baseline = currentRouting?.routes && Object.keys(currentRouting.routes).length
    ? currentRouting
    : routeWithPreferences({ ...originalGeometry, wires: project.wires, grid, gap, autoRoute: false, preserveRoutes: true });
  const candidate = clone(project), tags = [];
  const tagGroupName = nextTagName(candidate.nodes);
  const usedIds = new Set([...candidate.nodes, ...candidate.wires].map(item => item.id));
  const newId = prefix => {
    const base = makeId(prefix);
    let id = base, suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return id;
  };
  for (const endpoint of endpoints) {
    const placement = tagPlacement(endpoint);
    const position = findConnectorTagPosition({ nodes: candidate.nodes, types, desired: placement.desired,
      grid, snapToGrid: candidate.settings?.snap !== false, routes: baseline.routes, ignoreWireIds: [wireId] });
    if (!position) throw placementError();
    const tag = { id: newId('tag'), kind: 'tag', name: tagGroupName, wireSide: placement.wireSide, ...position };
    candidate.nodes.push(tag); tags.push(tag);
  }
  candidate.wires = candidate.wires.filter(w => w.id !== wireId);
  // Freeze the actual visible geometry even if the caller has not yet copied
  // the latest generated routes back into its project snapshot.
  for (const wire of candidate.wires) {
    const before = baseline.routes[wire.id];
    if (!before?.points?.length) continue;
    const saved = captureManualRoute(before.points, originalGeometry.ports[wire.from], originalGeometry.ports[wire.to]);
    if (saved) wire.savedRoute = saved;
    else if (before.status !== 'blocked') throw routingError();
  }
  const newWires = endpoints.map((endpoint, index) => ({
    id: newId('wire'), from: endpoint.id, to: `${tags[index].id}:connector`,
    color: original.color, width: original.width,
  }));
  candidate.wires.push(...newWires);
  const routing = routeWithPreferences({ ...geometry(candidate.nodes, types), wires: candidate.wires, grid, gap, autoRoute: false, preserveRoutes: true });
  if (newWires.some(w => !routing.routes[w.id]?.points?.length || routing.routes[w.id].status === 'blocked')) throw routingError();
  for (const wire of candidate.wires) {
    if (newWires.includes(wire)) continue;
    const before = baseline.routes[wire.id], after = routing.routes[wire.id];
    if (before && before.status !== 'blocked' && (!after?.points?.length || after.status === 'blocked')) throw routingError();
    if (before?.points?.length && !samePoints(before.points, after?.points)) throw routingError();
  }
  for (const wire of candidate.wires) if (routing.savedRoutes[wire.id]) wire.savedRoute = routing.savedRoutes[wire.id];
  return { project: candidate, tags, routing };
}
