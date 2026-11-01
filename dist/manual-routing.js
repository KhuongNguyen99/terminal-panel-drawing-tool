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
const direction = port => port.side === 'left' ? -1 : 1;

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
  return validPoint(value) && ['left', 'right'].includes(value.side) ? { ...copyPoint(value), side: value.side } : null;
}

/** Sanitize bounded JSON data while preserving exact, possibly off-grid ports. */
export function normalizeManualRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const points = polyline(value.points), from = anchor(value.from), to = anchor(value.to);
  if (!points || !from || !to || !equal(points[0], from) || !equal(points.at(-1), to)) return null;
  if (!close(points[0].y, points[1].y) || !close(points.at(-1).y, points.at(-2).y)) return null;
  if ((points[1].x - from.x) * direction(from) <= EPS || (points.at(-2).x - to.x) * direction(to) <= EPS) return null;
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

/** Optional escapeX comes from the router's obstacle-aware port escape. */
function escapeX(port, grid, gap) {
  if (bounded(port.escapeX) && (port.escapeX - port.x) * direction(port) > EPS) return port.escapeX;
  const boundary = port.x + direction(port) * Math.max(grid, gap);
  return (port.side === 'left' ? Math.floor(boundary / grid) : Math.ceil(boundary / grid)) * grid;
}

function constrainTrunk(x, ports, grid, gap) {
  let lower = -LIMIT, upper = LIMIT;
  for (const port of ports) {
    if (port.side === 'left') upper = Math.min(upper, escapeX(port, grid, gap));
    else lower = Math.max(lower, escapeX(port, grid, gap));
  }
  return lower > upper + EPS ? null : Math.max(lower, Math.min(upper, x));
}

function finished(points, from, to) {
  const manual = captureManualRoute(points, from, to);
  return manual?.points || null;
}

function moveFirstSegment(points, coordinate, from, to, grid, gap) {
  if (close(coordinate, points[0].y)) return points.map(copyPoint);
  const startX = escapeX(from, grid, gap);
  if (points.length === 2) {
    const endX = escapeX(to, grid, gap);
    if (close(startX, endX)) return null;
    return finished([
      from, { x: startX, y: from.y }, { x: startX, y: coordinate },
      { x: endX, y: coordinate }, { x: endX, y: to.y }, to,
    ], from, to);
  }
  const rest = points.slice(1).map(copyPoint);
  // A short endpoint stub still needs room for a draggable horizontal section.
  // Move its adjacent vertical trunk out by a cell instead of folding the wire
  // back across its own terminal lead.
  let trunkX = rest[0].x;
  if ((trunkX - startX) * direction(from) < grid - EPS) {
    trunkX = startX + direction(from) * grid;
    rest[0].x = trunkX;
    if (rest[1] && close(rest[1].x, points[1].x)) rest[1].x = trunkX;
  }
  rest[0].y = coordinate;
  return finished([from, { x: startX, y: from.y }, { x: startX, y: coordinate }, ...rest], from, to);
}

/**
 * Move one segment perpendicular to itself. Invalid or impossible geometry
 * returns null. Obstacle/other-wire conflicts are checked by routeWires.
 */
export function moveWireSegment(inputPoints, segmentIndex, coordinate, options = {}) {
  // Keep the original segment index: callers index the rendered compact route.
  const points = polyline(inputPoints);
  if (!points || !Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= points.length - 1 || !bounded(coordinate)) return null;
  const from = options.from || { ...points[0], side: points[1].x < points[0].x ? 'left' : 'right' };
  const to = options.to || { ...points.at(-1), side: points.at(-2).x < points.at(-1).x ? 'left' : 'right' };
  if (!captureManualRoute(points, from, to)) return null;
  const { grid, gap } = settings(options);
  coordinate = options.snap === false ? rounded(coordinate) : Math.round(coordinate / grid) * grid;
  if (segmentIndex === 0) return moveFirstSegment(points, coordinate, from, to, grid, gap);
  if (segmentIndex === points.length - 2) {
    const reversed = moveFirstSegment(points.slice().reverse(), coordinate, to, from, grid, gap);
    return reversed?.reverse() || null;
  }
  const moved = points.map(copyPoint), a = moved[segmentIndex], b = moved[segmentIndex + 1];
  if (close(a.y, b.y)) a.y = b.y = coordinate;
  else {
    const attached = [];
    if (segmentIndex === 1) attached.push(from);
    if (segmentIndex === points.length - 3) attached.push(to);
    coordinate = constrainTrunk(coordinate, attached, grid, gap);
    if (coordinate === null) return null;
    a.x = b.x = coordinate;
  }
  return finished(moved, from, to);
}

/**
 * Reconnect saved bends to current ports. Shared translation moves the whole
 * route. Otherwise the terminal stubs and their adjoining vertical bends adapt
 * while the remaining hand-positioned segments stay where the user put them.
 */
export function resolveManualRoute(value, fromInput, toInput, options = {}) {
  const manual = normalizeManualRoute(value), from = anchor(fromInput), to = anchor(toInput);
  if (!manual || !from || !to) return null;
  const { grid, gap } = settings(options);
  const fromPort = { ...from, escapeX: fromInput.escapeX }, toPort = { ...to, escapeX: toInput.escapeX };
  const dxFrom = from.x - manual.from.x, dyFrom = from.y - manual.from.y;
  const dxTo = to.x - manual.to.x, dyTo = to.y - manual.to.y;
  if (from.side === manual.from.side && to.side === manual.to.side && close(dxFrom, dxTo) && close(dyFrom, dyTo)) {
    return finished(manual.points.map(p => ({ x: p.x + dxFrom, y: p.y + dyFrom })), from, to);
  }
  const points = manual.points.map(copyPoint);
  if (points.length <= 4) {
    const originalX = points.length === 4 ? points[1].x : (escapeX(fromPort, grid, gap) + escapeX(toPort, grid, gap)) / 2;
    const trunkX = constrainTrunk(Math.round(originalX / grid) * grid, [fromPort, toPort], grid, gap);
    if (trunkX === null) {
      const startX = escapeX(fromPort, grid, gap), endX = escapeX(toPort, grid, gap);
      const outsideY = Math.round((Math.min(from.y, to.y) - Math.max(grid, gap) * 2) / grid) * grid;
      return finished([from, { x: startX, y: from.y }, { x: startX, y: outsideY }, { x: endX, y: outsideY }, { x: endX, y: to.y }, to], from, to);
    }
    return finished([from, { x: trunkX, y: from.y }, { x: trunkX, y: to.y }, to], from, to);
  }
  points[0] = copyPoint(from); points[points.length - 1] = copyPoint(to);
  const startX = constrainTrunk(points[1].x, [fromPort], grid, gap);
  const endX = constrainTrunk(points.at(-2).x, [toPort], grid, gap);
  if (startX === null || endX === null) return null;
  points[1].y = from.y;
  if (close(manual.points[1].x, manual.points[2].x)) points[2].x = startX;
  points[1].x = startX;
  points[points.length - 2].y = to.y;
  if (close(manual.points.at(-2).x, manual.points.at(-3).x)) points[points.length - 3].x = endX;
  points[points.length - 2].x = endX;
  return finished(points, from, to);
}
