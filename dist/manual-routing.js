/**
 * Geometry for editable orthogonal wires. This module deliberately knows nothing
 * about project state or obstacles: the router remains the authority on whether
 * an edited route has a clear lane.
 *
 * Segment indexes identify points[index] -> points[index + 1]. Horizontal
 * segments move along Y; vertical segments move along X. Endpoint segments grow
 * two bends so the terminal itself never moves.
 */

const EPS = 1e-6;
const LIMIT = 100000;
const MAX_POINTS = 128;
const close = (a, b) => Math.abs(a - b) < EPS;
const equal = (a, b) => close(a.x, b.x) && close(a.y, b.y);
const rounded = n => Math.round(n * 1e6) / 1e6;
const bounded = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMIT;
const validPoint = p => p && bounded(p.x) && bounded(p.y);
const copyPoint = p => ({ x: rounded(p.x), y: rounded(p.y) });
const direction = port => port.side === 'left' || port.side === 'top' ? -1 : 1;
const axisOf = port => port.side === 'top' || port.side === 'bottom' ? 'y' : 'x';
const crossOf = axis => axis === 'x' ? 'y' : 'x';
const at = (axis, value, cross) => ({ [axis]: value, [crossOf(axis)]: cross });
const inferredSide = (port, adjacent) => close(port.y, adjacent.y)
  ? (adjacent.x < port.x ? 'left' : 'right') : (adjacent.y < port.y ? 'top' : 'bottom');

function compact(points) {
  const result = [];
  for (const raw of points) {
    const p = copyPoint(raw);
    if (result.length && equal(result.at(-1), p)) continue;
    while (result.length >= 2) {
      const a = result.at(-2), b = result.at(-1);
      const sameAxis = (close(a.x, b.x) && close(b.x, p.x)) || (close(a.y, b.y) && close(b.y, p.y));
      const between = b.x >= Math.min(a.x, p.x) - EPS && b.x <= Math.max(a.x, p.x) + EPS &&
        b.y >= Math.min(a.y, p.y) - EPS && b.y <= Math.max(a.y, p.y) + EPS;
      if (!sameAxis || !between) break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}

function polyline(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POINTS || !value.every(validPoint)) return null;
  for (let i = 1; i < value.length; i++) if (!close(value[i - 1].x, value[i].x) && !close(value[i - 1].y, value[i].y)) return null;
  const points = compact(value);
  return points.length >= 2 && points.length <= MAX_POINTS ? points : null;
}

function anchor(value) {
  return validPoint(value) && ['left', 'right', 'top', 'bottom'].includes(value.side) ? { ...copyPoint(value), side: value.side } : null;
}

function outward(point, port) {
  const axis = axisOf(port), cross = crossOf(axis);
  return close(point[cross], port[cross]) && (point[axis] - port[axis]) * direction(port) > EPS;
}

/** Sanitize bounded JSON data while preserving exact, possibly off-grid ports. */
export function normalizeManualRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const points = polyline(value.points), from = anchor(value.from), to = anchor(value.to);
  if (!points || !from || !to || !equal(points[0], from) || !equal(points.at(-1), to)) return null;
  if (!outward(points[1], from) || !outward(points.at(-2), to)) return null;
  return { points, from, to };
}

export function captureManualRoute(points, from, to) {
  return normalizeManualRoute({ points, from, to });
}

function settings(options = {}) {
  const grid = Number.isFinite(Number(options.grid)) ? Math.max(2, Math.min(100, Number(options.grid))) : 10;
  const gap = Number.isFinite(Number(options.gap)) ? Math.max(0, Math.min(1000, Number(options.gap))) : grid;
  return { grid, gap };
}

/** Optional escapeX/escapeY comes from the router's obstacle-aware port escape. */
function escapeCoordinate(port, grid, gap) {
  const axis = axisOf(port), hint = axis === 'x' ? port.escapeX : port.escapeY;
  if (bounded(hint) && (hint - port[axis]) * direction(port) > EPS) return hint;
  const boundary = port[axis] + direction(port) * Math.max(grid, gap);
  return (direction(port) < 0 ? Math.floor(boundary / grid) : Math.ceil(boundary / grid)) * grid;
}

function constrainTrunk(coordinate, ports, grid, gap, axis = 'x') {
  let lower = -LIMIT, upper = LIMIT;
  for (const port of ports) {
    if (axisOf(port) !== axis) continue;
    if (direction(port) < 0) upper = Math.min(upper, escapeCoordinate(port, grid, gap));
    else lower = Math.max(lower, escapeCoordinate(port, grid, gap));
  }
  return lower > upper + EPS ? null : Math.max(lower, Math.min(upper, coordinate));
}

function finished(points, from, to) {
  const manual = captureManualRoute(points, from, to);
  return manual?.points || null;
}

function moveFirstSegment(points, coordinate, from, to, grid, gap) {
  const axis = axisOf(from), cross = crossOf(axis);
  if (close(coordinate, points[0][cross])) return points.map(copyPoint);
  const start = escapeCoordinate(from, grid, gap);
  if (points.length === 2) {
    const end = escapeCoordinate(to, grid, gap);
    if (close(start, end)) return null;
    return finished([
      from, at(axis, start, from[cross]), at(axis, start, coordinate),
      at(axis, end, coordinate), at(axis, end, to[cross]), to,
    ], from, to);
  }
  const rest = points.slice(1).map(copyPoint);
  // A short endpoint stub still needs room for a draggable parallel section.
  // Move its adjacent trunk out by a cell instead of folding the wire
  // back across its own terminal lead.
  let trunk = rest[0][axis];
  if ((trunk - start) * direction(from) < grid - EPS) {
    trunk = start + direction(from) * grid;
    // For an L-shaped route the next point is the other terminal. Add its
    // own escape instead of moving that terminal with the adjacent trunk.
    if (rest.length === 2 && axisOf(to) !== axis) {
      const end = escapeCoordinate(to, grid, gap);
      return finished([from, at(axis, start, from[cross]), at(axis, start, coordinate),
        at(axis, trunk, coordinate), at(axis, trunk, end), at(axis, to[axis], end), to], from, to);
    }
    rest[0][axis] = trunk;
    if (rest[1] && close(rest[1][axis], points[1][axis])) rest[1][axis] = trunk;
  }
  rest[0][cross] = coordinate;
  return finished([from, at(axis, start, from[cross]), at(axis, start, coordinate), ...rest], from, to);
}

/**
 * Move one segment perpendicular to itself. Invalid or impossible geometry
 * returns null. Obstacle/other-wire conflicts are checked by routeWires.
 */
export function moveWireSegment(inputPoints, segmentIndex, coordinate, options = {}) {
  // Keep the original segment index: callers index the rendered compact route.
  const points = polyline(inputPoints);
  if (!points || !Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= points.length - 1 || !bounded(coordinate)) return null;
  const from = options.from || { ...points[0], side: inferredSide(points[0], points[1]) };
  const to = options.to || { ...points.at(-1), side: inferredSide(points.at(-1), points.at(-2)) };
  if (!captureManualRoute(points, from, to)) return null;
  const { grid, gap } = settings(options);
  coordinate = options.snap === false ? rounded(coordinate) : Math.round(coordinate / grid) * grid;
  if (segmentIndex === 0) return moveFirstSegment(points, coordinate, from, to, grid, gap);
  if (segmentIndex === points.length - 2) {
    const reversed = moveFirstSegment(points.slice().reverse(), coordinate, to, from, grid, gap);
    return reversed?.reverse() || null;
  }
  const moved = points.map(copyPoint), a = moved[segmentIndex], b = moved[segmentIndex + 1];
  const movedAxis = close(a.y, b.y) ? 'y' : 'x';
  const attached = [];
  if (segmentIndex === 1) attached.push(from);
  if (segmentIndex === points.length - 3) attached.push(to);
  coordinate = constrainTrunk(coordinate, attached, grid, gap, movedAxis);
  if (coordinate === null) return null;
  a[movedAxis] = b[movedAxis] = coordinate;
  return finished(moved, from, to);
}

function reconnectShort(points, from, to, grid, gap) {
  const axis = axisOf(from), cross = crossOf(axis);
  const start = escapeCoordinate(from, grid, gap), end = escapeCoordinate(to, grid, gap);
  if (axisOf(to) === axis) {
    const original = points.length === 4 && close(points[0][cross], points[1][cross])
      ? points[1][axis] : (start + end) / 2;
    const trunk = constrainTrunk(Math.round(original / grid) * grid, [from, to], grid, gap, axis);
    if (trunk !== null && (!close(from[cross], to[cross]) || direction(from) !== direction(to))) {
      const simple = finished([from, at(axis, trunk, from[cross]), at(axis, trunk, to[cross]), to], from, to);
      if (simple) return simple;
    }
    const outside = Math.round((Math.min(from[cross], to[cross]) - Math.max(grid, gap) * 2) / grid) * grid;
    return finished([from, at(axis, start, from[cross]), at(axis, start, outside),
      at(axis, end, outside), at(axis, end, to[cross]), to], from, to);
  }
  // Mixed horizontal/vertical terminals can share an L bend when both leads
  // point outwards far enough. Otherwise retain one clear stub at each end.
  const corner = at(axis, to[axis], from[cross]);
  if ((corner[axis] - start) * direction(from) >= -EPS &&
      (corner[cross] - end) * direction(to) >= -EPS) {
    const simple = finished([from, corner, to], from, to);
    if (simple) return simple;
  }
  return finished([from, at(axis, start, from[cross]), at(axis, start, end),
    at(axis, to[axis], end), to], from, to);
}

/**
 * Reconnect saved bends to current ports. Shared translation moves the whole
 * route. Otherwise the terminal stubs and their adjoining bends adapt
 * while the remaining hand-positioned segments stay where the user put them.
 */
export function resolveManualRoute(value, fromInput, toInput, options = {}) {
  const manual = normalizeManualRoute(value), from = anchor(fromInput), to = anchor(toInput);
  if (!manual || !from || !to) return null;
  const { grid, gap } = settings(options);
  const fromPort = { ...from, escapeX: fromInput.escapeX, escapeY: fromInput.escapeY };
  const toPort = { ...to, escapeX: toInput.escapeX, escapeY: toInput.escapeY };
  const dxFrom = from.x - manual.from.x, dyFrom = from.y - manual.from.y;
  const dxTo = to.x - manual.to.x, dyTo = to.y - manual.to.y;
  if (from.side === manual.from.side && to.side === manual.to.side && close(dxFrom, dxTo) && close(dyFrom, dyTo)) {
    return finished(manual.points.map(p => ({ x: p.x + dxFrom, y: p.y + dyFrom })), from, to);
  }
  const points = manual.points.map(copyPoint);
  if (points.length <= 4) return reconnectShort(points, fromPort, toPort, grid, gap);
  // Modules keep their fixed port sides; cable-label flips can reverse a side.
  // When an imported endpoint changes axes, reconnect a short new lead to its
  // old interior join rather than discarding the hand-positioned middle route.
  const adapt = (route, original, port, oldPort) => {
    const axis = axisOf(port), cross = crossOf(axis);
    if (axis !== axisOf(oldPort)) {
      const join = { ...original[2], side: inferredSide(original[2], original[1]) };
      const lead = reconnectShort([], port, join, grid, gap);
      return lead ? [...lead.slice(0, -1), ...route.slice(2)] : null;
    }
    const trunk = constrainTrunk(route[1][axis], [port], grid, gap, axis);
    if (trunk === null) return null;
    route[0] = copyPoint(port); route[1][cross] = port[cross];
    if (close(original[1][axis], original[2][axis])) route[2][axis] = trunk;
    route[1][axis] = trunk;
    return route;
  };
  const start = adapt(points, manual.points, fromPort, manual.from);
  if (!start) return null;
  const end = adapt(start.slice().reverse(), manual.points.slice().reverse(), toPort, manual.to);
  if (!end) return null;
  return finished(end.reverse(), from, to);
}
