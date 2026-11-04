import { resolveManualRoute } from './manual-routing.js';

/**
 * Deterministic, obstacle-aware orthogonal wire routing.
 *
 * Public API:
 *   routeWires({ wires, ports, obstacles, grid = 10, gap = 10, preserveBlockedRoutes = false })
 *   -> { routes: { [wireId]: { points, status, crossings, diagnostics, grid, gap } }, diagnostics, grid, gap }
 * The result identifies the board defaults and the grid and clearance used by each wire.
 *
 * Ports are { id, nodeId, x, y, side: 'left' | 'right' | 'top' | 'bottom' } and may be passed
 * as an array, a Map, or an object. Wires have { id, from, to, width?, manual? };
 * from/to are port IDs or complete port objects. Obstacles have
 * { id / nodeId, x, y, width, height } (w/h aliases are accepted).
 *
 * Only the short escape stubs may pass through their own port's obstacle.
 * All interior bends lie on the routing grid. A route is never replaced by
 * a misleading straight line when the available space is blocked.
 */

const EPS = 1e-6;
const finite = Number.isFinite;
const eq = (a, b) => Math.abs(a - b) < EPS;
const pointEqual = (a, b) => eq(a.x, b.x) && eq(a.y, b.y);
const rounded = n => Math.round(n * 1e6) / 1e6;

function compact(points) {
  const result = [];
  for (const input of points) {
    const p = { x: rounded(input.x), y: rounded(input.y) };
    if (result.length && pointEqual(result[result.length - 1], p)) continue;
    while (result.length >= 2) {
      const a = result[result.length - 2], b = result[result.length - 1];
      const sameAxis = (eq(a.x, b.x) && eq(b.x, p.x)) || (eq(a.y, b.y) && eq(b.y, p.y));
      const between = b.x >= Math.min(a.x, p.x) - EPS && b.x <= Math.max(a.x, p.x) + EPS &&
        b.y >= Math.min(a.y, p.y) - EPS && b.y <= Math.max(a.y, p.y) + EPS;
      if (!sameAxis || !between) break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}

function segments(points, wireId = '') {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (pointEqual(a, b)) continue;
    const horizontal = eq(a.y, b.y);
    out.push({
      a, b, horizontal, fixed: horizontal ? a.y : a.x,
      lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y), wireId,
    });
  }
  return out;
}

function overlaps(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > EPS;
}

function segmentHitsRect(a, b, r) {
  if (eq(a.y, b.y)) {
    return a.y > r.top + EPS && a.y < r.bottom - EPS &&
      overlaps(Math.min(a.x, b.x), Math.max(a.x, b.x), r.left, r.right);
  }
  return a.x > r.left + EPS && a.x < r.right - EPS &&
    overlaps(Math.min(a.y, b.y), Math.max(a.y, b.y), r.top, r.bottom);
}

class MinHeap {
  constructor() { this.items = []; }
  get length() { return this.items.length; }
  push(item) {
    const a = this.items;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (MinHeap.before(a[p], item)) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= a.length) break;
        if (child + 1 < a.length && MinHeap.before(a[child + 1], a[child])) child++;
        if (MinHeap.before(last, a[child])) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
  static before(a, b) {
    return a.f < b.f || (a.f === b.f && (a.h < b.h || (a.h === b.h && a.state < b.state)));
  }
}

/** Segment buckets make per-grid-edge occupancy checks independent of board area. */
class SegmentIndex {
  constructor(grid, gap) {
    this.grid = grid; this.gap = gap;
    this.horizontal = new Map(); this.vertical = new Map();
    this.all = [];
  }
  add(points, wireId, exemptWireIds = null) {
    for (const seg of segments(points, wireId)) {
      seg.gap = this.gap;
      if (exemptWireIds) seg.exemptWireIds = exemptWireIds;
      const index = seg.horizontal ? this.horizontal : this.vertical;
      const bucket = Math.floor(seg.fixed / this.grid);
      if (!index.has(bucket)) index.set(bucket, []);
      index.get(bucket).push(seg);
      this.all.push(seg);
    }
  }
  candidates(index, low, high) {
    const result = [];
    for (let k = Math.floor((low - EPS) / this.grid); k <= Math.floor((high + EPS) / this.grid); k++) {
      const list = index.get(k);
      if (list) result.push(...list);
    }
    return result;
  }
  /** Returns a crossing count, or Infinity for a shared, too-close, or obstructed lane. */
  cost(a, b, allowCrossings, ownStubs = [], skipWireId = null) {
    const horizontal = eq(a.y, b.y), fixed = horizontal ? a.y : a.x;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const same = this.candidates(horizontal ? this.horizontal : this.vertical,
      fixed - this.gap, fixed + this.gap);
    for (const other of same) {
      if (other.exemptWireIds?.has(skipWireId)) continue;
      const distance = Math.abs(fixed - other.fixed);
      if (distance < Math.min(this.gap, other.gap) - EPS && overlaps(lo, hi, other.lo, other.hi)) return Infinity;
      if (eq(fixed, other.fixed) && overlaps(lo, hi, other.lo, other.hi)) return Infinity;
    }
    for (const s of ownStubs) {
      if (s.horizontal === horizontal && eq(s.fixed, fixed) && overlaps(lo, hi, s.lo, s.hi)) return Infinity;
    }
    let crossings = 0;
    const perpendicular = this.candidates(horizontal ? this.vertical : this.horizontal, lo, hi);
    for (const other of perpendicular) {
      if (other.exemptWireIds?.has(skipWireId)) continue;
      if (other.fixed < lo - EPS || other.fixed > hi + EPS || fixed < other.lo - EPS || fixed > other.hi + EPS) continue;
      // Crossing a previous bend or endpoint produces a junction-like ambiguity.
      if (eq(fixed, other.lo) || eq(fixed, other.hi)) return Infinity;
      if (!allowCrossings) return Infinity;
      crossings++;
    }
    for (const s of ownStubs) {
      if (s.horizontal === horizontal) continue;
      if (s.fixed > lo + EPS && s.fixed < hi - EPS && fixed > s.lo + EPS && fixed < s.hi - EPS) return Infinity;
    }
    return crossings;
  }
  crossings(points) {
    const out = [], seen = new Set();
    for (const s of segments(points)) {
      const list = this.candidates(s.horizontal ? this.vertical : this.horizontal, s.lo, s.hi);
      for (const other of list) {
        if (other.fixed <= s.lo + EPS || other.fixed >= s.hi - EPS || s.fixed <= other.lo + EPS || s.fixed >= other.hi - EPS) continue;
        const x = s.horizontal ? other.fixed : s.fixed, y = s.horizontal ? s.fixed : other.fixed;
        const key = `${rounded(x)},${rounded(y)},${other.wireId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: rounded(x), y: rounded(y), otherWireId: other.wireId,
          orientation: s.horizontal ? 'horizontal' : 'vertical' });
      }
    }
    return out;
  }
}

function normalizePorts(ports) {
  if (ports instanceof Map) return ports;
  if (Array.isArray(ports)) return new Map(ports.map(p => [p.id, p]));
  return new Map(Object.entries(ports || {}));
}

function normalizeRects(obstacles, padding) {
  const out = [];
  for (const r of obstacles || []) {
    const x = Number(r.x), y = Number(r.y), width = Number(r.width ?? r.w), height = Number(r.height ?? r.h);
    if (![x, y, width, height].every(finite) || width < 0 || height < 0) continue;
    out.push({ nodeId: r.nodeId ?? r.id,
      left: x - padding, right: x + width + padding,
      top: y - padding, bottom: y + height + padding,
      raw: { left: x, right: x + width, top: y, bottom: y + height } });
  }
  return out;
}

function escapePort(port, rects, grid) {
  const owners = rects.filter(r => r.nodeId !== undefined && r.nodeId === port.nodeId);
  const vertical = port.side === 'top' || port.side === 'bottom';
  const axis = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y';
  const negative = port.side === 'left' || port.side === 'top';
  const edge = vertical ? (negative ? 'top' : 'bottom') : (negative ? 'left' : 'right');
  const boundary = owners.length
    ? (negative ? Math.min(port[axis], ...owners.map(r => r[edge])) : Math.max(port[axis], ...owners.map(r => r[edge])))
    : port[axis] + (negative ? -grid / 2 : grid / 2);
  const outward = (negative ? Math.floor((boundary - EPS) / grid) : Math.ceil((boundary + EPS) / grid)) * grid;
  const anchor = { [axis]: outward, [cross]: Math.round(port[cross] / grid) * grid };
  const points = compact([{ x: port.x, y: port.y }, { [axis]: outward, [cross]: port[cross] }, anchor]);
  for (let i = 1; i < points.length; i++) {
    for (const r of rects) {
      // The first outward segment is the only owner exception.
      if (i === 1 && r.nodeId !== undefined && r.nodeId === port.nodeId) continue;
      if (segmentHitsRect(points[i - 1], points[i], r)) return null;
    }
  }
  return { points, anchor, owners,
    direction: points.length > 1 && eq(points[points.length - 2].x, anchor.x) ? 1 : 0 };
}

function makeBounds(a, b, rects, grid, margin, includeObstacles) {
  let left = Math.min(a.x, b.x) - margin * grid, right = Math.max(a.x, b.x) + margin * grid;
  let top = Math.min(a.y, b.y) - margin * grid, bottom = Math.max(a.y, b.y) + margin * grid;
  if (includeObstacles) {
    // Include nearby blocking objects' edges, so a tall module can be bypassed.
    // Do two passes: a detour can reveal a neighboring obstacle.
    for (let pass = 0; pass < 2; pass++) {
      for (const r of rects) {
        if (r.left > right || r.right < left || r.top > bottom || r.bottom < top) continue;
        left = Math.min(left, r.left - grid * 3); right = Math.max(right, r.right + grid * 3);
        top = Math.min(top, r.top - grid * 3); bottom = Math.max(bottom, r.bottom + grid * 3);
      }
    }
  }
  const minX = Math.floor(left / grid), maxX = Math.ceil(right / grid);
  const minY = Math.floor(top / grid), maxY = Math.ceil(bottom / grid);
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Rasterize blocked grid edges, including obstacles thinner than one grid cell. */
function obstacleEdges(bounds, rects, grid) {
  const { minX, maxX, minY, maxY, width: w, height: h } = bounds;
  const horizontal = new Uint8Array(w * h), vertical = new Uint8Array(w * h);
  for (const r of rects) {
    let x0 = Math.max(minX, Math.floor((r.left + EPS) / grid));
    let x1 = Math.min(maxX - 1, Math.ceil((r.right - EPS) / grid) - 1);
    let y0 = Math.max(minY, Math.floor((r.top + EPS) / grid) + 1);
    let y1 = Math.min(maxY, Math.ceil((r.bottom - EPS) / grid) - 1);
    for (let y = y0; x0 <= x1 && y <= y1; y++) {
      const row = (y - minY) * w;
      horizontal.fill(1, row + x0 - minX, row + x1 - minX + 1);
    }
    x0 = Math.max(minX, Math.floor((r.left + EPS) / grid) + 1);
    x1 = Math.min(maxX, Math.ceil((r.right - EPS) / grid) - 1);
    y0 = Math.max(minY, Math.floor((r.top + EPS) / grid));
    y1 = Math.min(maxY - 1, Math.ceil((r.bottom - EPS) / grid) - 1);
    for (let y = y0; x0 <= x1 && y <= y1; y++) {
      const row = (y - minY) * w;
      vertical.fill(1, row + x0 - minX, row + x1 - minX + 1);
    }
  }
  return { horizontal, vertical };
}

function search(start, end, rects, occupied, grid, options) {
  const { bounds, allowCrossings, limit, reserved, wireId } = options;
  const { width: w, height: h, minX, minY } = bounds;
  if (w <= 0 || h <= 0 || w * h > 420000) return { points: null, reason: 'Routing area exceeds the supported grid size.' };
  const sx = Math.round(start.anchor.x / grid) - minX, sy = Math.round(start.anchor.y / grid) - minY;
  const tx = Math.round(end.anchor.x / grid) - minX, ty = Math.round(end.anchor.y / grid) - minY;
  if (sx === tx && sy === ty) return { points: [start.anchor], visited: 0 };
  const geometry = obstacleEdges(bounds, rects, grid);
  const costH = new Float64Array(w * h), costV = new Float64Array(w * h);
  costH.fill(NaN); costV.fill(NaN);
  const costs = new Float64Array(w * h * 2); costs.fill(Infinity);
  const previous = new Int32Array(w * h * 2); previous.fill(-1);
  const closed = new Uint8Array(w * h * 2);
  const ownStubs = [...segments(start.points), ...segments(end.points)];
  const heap = new MinHeap();
  const startState = (sy * w + sx) * 2 + start.direction;
  costs[startState] = 0;
  const heuristic = (x, y) => (Math.abs(tx - x) + Math.abs(ty - y)) * grid;
  heap.push({ state: startState, g: 0, h: heuristic(sx, sy), f: heuristic(sx, sy) });
  let goal = -1, visits = 0;
  while (heap.length && visits < limit) {
    const current = heap.pop(), state = current.state;
    if (closed[state] || current.g > costs[state] + EPS) continue;
    closed[state] = 1; visits++;
    const cell = state >> 1, direction = state & 1, x = cell % w, y = Math.floor(cell / w);
    if (x === tx && y === ty) { goal = state; break; }
    // Stable preference toward the target improves responsiveness without changing optimality.
    const horizontalFirst = Math.abs(tx - x) >= Math.abs(ty - y);
    const horizontalMoves = tx >= x ? [[1, 0, 0], [-1, 0, 0]] : [[-1, 0, 0], [1, 0, 0]];
    const verticalMoves = ty >= y ? [[0, 1, 1], [0, -1, 1]] : [[0, -1, 1], [0, 1, 1]];
    const moves = horizontalFirst ? [...horizontalMoves, ...verticalMoves] : [...verticalMoves, ...horizontalMoves];
    for (const [dx, dy, nextDirection] of moves) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nextState = (ny * w + nx) * 2 + nextDirection;
      if (closed[nextState]) continue;
      const edgeCell = dy ? Math.min(y, ny) * w + x : y * w + Math.min(x, nx);
      const blocked = dy ? geometry.vertical : geometry.horizontal;
      if (blocked[edgeCell]) continue;
      const cache = dy ? costV : costH;
      let occupiedCost = cache[edgeCell];
      if (Number.isNaN(occupiedCost)) {
        occupiedCost = occupied.cost(
          { x: (x + minX) * grid, y: (y + minY) * grid },
          { x: (nx + minX) * grid, y: (ny + minY) * grid }, allowCrossings, ownStubs) * grid * 32;
        if (reserved && finite(occupiedCost)) {
          occupiedCost += reserved.cost(
            { x: (x + minX) * grid, y: (y + minY) * grid },
            { x: (nx + minX) * grid, y: (ny + minY) * grid }, false, [], wireId);
        }
        cache[edgeCell] = occupiedCost;
      }
      if (!finite(occupiedCost)) continue;
      let nextCost = costs[state] + grid + occupiedCost + (direction === nextDirection ? 0 : grid * 2.25);
      if (nx === tx && ny === ty && nextDirection !== end.direction) nextCost += grid * 2.25;
      if (nextCost + EPS >= costs[nextState]) continue;
      costs[nextState] = nextCost; previous[nextState] = state;
      const estimate = heuristic(nx, ny);
      heap.push({ state: nextState, g: nextCost, h: estimate, f: nextCost + estimate });
    }
  }
  if (goal < 0) return { points: null, visited: visits, reason: visits >= limit ? 'Search budget reached.' : 'No clear route in this area.' };
  const path = [];
  for (let state = goal; state >= 0; state = previous[state]) {
    const cell = state >> 1;
    path.push({ x: (cell % w + minX) * grid, y: (Math.floor(cell / w) + minY) * grid });
  }
  path.reverse();
  return { points: compact(path), visited: visits };
}

function validPort(port) {
  return port && finite(Number(port.x)) && finite(Number(port.y)) && ['left', 'right', 'top', 'bottom'].includes(port.side);
}

/** True when a proposed full route folds onto or crosses its own nonadjacent segments. */
function selfIntersects(points) {
  const ss = segments(points);
  for (let i = 0; i < ss.length; i++) {
    for (let j = i + 2; j < ss.length; j++) {
      const a = ss[i], b = ss[j];
      if (a.horizontal === b.horizontal) {
        if (eq(a.fixed, b.fixed) && overlaps(a.lo, a.hi, b.lo, b.hi)) return true;
      } else if (b.fixed > a.lo + EPS && b.fixed < a.hi - EPS && a.fixed > b.lo + EPS && a.fixed < b.hi - EPS) return true;
    }
  }
  return false;
}

function manualPathProblem(points, { from, to, start, end, rects, occupied, reserved, id }) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 512 ||
      points.some(p => !p || !finite(p.x) || !finite(p.y))) return 'The manual path is invalid.';
  if (!pointEqual(points[0], from) || !pointEqual(points.at(-1), to)) return 'The manual path must stay connected to both ports.';
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (pointEqual(a, b) || (!eq(a.x, b.x) && !eq(a.y, b.y))) return 'Manual wire segments must be horizontal or vertical.';
  }
  const first = points[1], last = points.at(-2);
  const startEscape = start.points[1] || start.anchor, endEscape = end.points[1] || end.anchor;
  const clearsEscape = (point, port, escape) => {
    const vertical = port.side === 'top' || port.side === 'bottom';
    const axis = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y';
    const sign = port.side === 'left' || port.side === 'top' ? -1 : 1;
    return eq(point[cross], port[cross]) && (point[axis] - port[axis]) * sign >= (escape[axis] - port[axis]) * sign - EPS;
  };
  if (!clearsEscape(first, from, startEscape) || !clearsEscape(last, to, endEscape)) {
    return 'Keep an outward connection stub between each port and the first bend.';
  }
  const ss = segments(points);
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    for (let j = i + 1; j < ss.length; j++) {
      const t = ss[j];
      if (s.horizontal === t.horizontal) {
        if (eq(s.fixed, t.fixed) && (overlaps(s.lo, s.hi, t.lo, t.hi) ||
            (j > i + 1 && Math.min(s.hi, t.hi) >= Math.max(s.lo, t.lo) - EPS))) {
          return 'The manual wire folds back over or touches itself.';
        }
      } else if (j > i + 1 && t.fixed >= s.lo - EPS && t.fixed <= s.hi + EPS &&
                 s.fixed >= t.lo - EPS && s.fixed <= t.hi + EPS) {
        return 'The manual wire crosses or touches itself.';
      }
    }
    for (const r of rects) {
      if (r.nodeId !== undefined && ((i === 0 && r.nodeId === from.nodeId) || (i === ss.length - 1 && r.nodeId === to.nodeId))) continue;
      if (segmentHitsRect(s.a, s.b, r)) return 'The manual wire passes through a component. Move this segment into a clear lane.';
    }
    if (!finite(occupied.cost(s.a, s.b, true))) return 'The manual wire overlaps another wire or sits too close to its lane.';
    if (!finite(reserved.cost(s.a, s.b, false, [], id))) return 'The manual wire crosses another port connection. Keep its escape lane clear.';
  }
  return '';
}

export function routeWires({ wires = [], ports = [], obstacles = [], grid: requestedGrid = 10, gap: requestedGap = 10, preserveBlockedRoutes = false } = {}) {
  const boardGrid = finite(Number(requestedGrid)) ? Math.max(2, Math.min(100, Number(requestedGrid))) : 10;
  const boardGap = finite(Number(requestedGap)) ? Math.max(0, Number(requestedGap)) : boardGrid;
  const portMap = normalizePorts(ports), routes = {};
  const getPort = value => {
    const port = typeof value === 'object' && value !== null ? value : portMap.get(value);
    return validPort(port) ? { ...port, x: Number(port.x), y: Number(port.y) } : null;
  };
  const widest = wires.reduce((m, w) => Math.max(m, Number(w.width) || 2), 2);
  const obstaclesByGap = new Map();
  const occupied = new SegmentIndex(boardGrid, boardGap), reserved = new SegmentIndex(boardGrid, 0);
  const portUsers = new Map();
  const diagnostics = { blocked: 0, crossings: 0, sharedSegments: 0, routed: 0, visited: 0 };
  // Fixed wires reserve their paths first. Keep source order within both groups.
  const orderedWires = [...wires.filter(wire => wire.manual != null), ...wires.filter(wire => wire.manual == null)];
  let fineGrid = boardGrid, fineGap = boardGap;
  const plans = orderedWires.map(wire => {
    const from = getPort(wire.from), to = getPort(wire.to);
    let grid = boardGrid, gap = boardGap;
    for (const port of [from, to]) {
      if (!finite(port?.routingPitch) || port.routingPitch < 2) continue;
      const aligned = eq(port.x % port.routingPitch, 0) && eq(port.y % port.routingPitch, 0);
      grid = Math.min(grid, aligned ? port.routingPitch : Math.max(2, port.routingPitch / 2));
      gap = Math.min(gap, port.routingPitch);
    }
    fineGrid = Math.min(fineGrid, grid);
    fineGap = Math.min(fineGap, gap);
    return { wire, from, to, grid, gap };
  });
  function lanes(from, to, grid, gap) {
    if (!obstaclesByGap.has(gap)) obstaclesByGap.set(gap, normalizeRects(obstacles, Math.max(gap / 2, widest / 2 + 2)));
    const rects = obstaclesByGap.get(gap);
    return { grid, gap, rects, start: from && escapePort(from, rects, grid), end: to && escapePort(to, rects, grid) };
  }
  for (const plan of plans) {
    const { wire, from, to, grid, gap } = plan;
    plan.fine = lanes(from, to, fineGrid, fineGap);
    // Historical fixed paths used the finest connected pitch. New searches start
    // on their own grid and can still use these escapes in a crowded part of a drawing.
    plan.preferred = wire.manual != null || (grid === fineGrid && gap === fineGap) ? plan.fine : lanes(from, to, grid, gap);
    for (const [port, escape] of [[from, plan.fine.start], [to, plan.fine.end]]) {
      if (!port) continue;
      const key = port.id ?? `${port.nodeId ?? ''}:${port.x}:${port.y}:${port.side}`;
      if (!portUsers.has(key)) portUsers.set(key, new Set());
      const users = portUsers.get(key);
      users.add(wire.id);
      if (escape) reserved.add(escape.points, key, users);
    }
  }
  function routePlan({ wire, from, to, fine }, lanes) {
    const { grid, gap, rects, start, end } = lanes;
    const id = wire.id;
    const result = { points: [], status: 'blocked', crossings: [], diagnostics: [], grid, gap };
    occupied.gap = gap;
    if (!from || !to) {
      result.diagnostics.push('A wire endpoint is missing or does not have a valid port side.'); return result;
    }
    let problem = '';
    if (pointEqual(from, to)) problem = 'The wire endpoints occupy the same position.';
    else if (!start || !end) problem = 'A component blocks the outward connection from this port. Move the overlapping components apart.';
    else if ([...segments(start.points), ...segments(end.points)].some(s =>
      !finite(occupied.cost(s.a, s.b, true)) || (lanes !== fine && !finite(reserved.cost(s.a, s.b, false, [], id))))) {
      problem = 'Another wire occupies this port escape lane. Use a free port or increase the space between ports.';
    }
    let path = null, lastReason = '';
    if (wire.manual != null && (!problem || preserveBlockedRoutes)) {
      const lead = (port, escape) => {
        const point = escape?.points[1] || escape?.anchor;
        return point ? { ...port, escapeX: point.x, escapeY: point.y } : port;
      };
      path = resolveManualRoute(wire.manual, lead(from, start), lead(to, end), { grid, gap });
      if (!problem) problem = manualPathProblem(path, { from, to, start, end, rects, occupied, reserved, id });
    }
    if (problem) {
      // Every fixed path retained on screen must reserve that same geometry.
      if (preserveBlockedRoutes && path) {
        result.points = path;
        occupied.add(path, id);
      }
      result.diagnostics.push(problem); return result;
    }
    const attempts = path ? [] : [
      { margin: 8, includeObstacles: false, allowCrossings: false, limit: 30000 },
      { margin: 16, includeObstacles: true, allowCrossings: false, limit: 60000 },
      { margin: 24, includeObstacles: true, allowCrossings: true, limit: 100000 },
    ];
    for (const attempt of attempts) {
      const bounds = makeBounds(start.anchor, end.anchor, rects, grid, attempt.margin, attempt.includeObstacles);
      const found = search(start, end, rects, occupied, grid, { ...attempt, bounds, reserved, wireId: id });
      diagnostics.visited += found.visited || 0;
      lastReason = found.reason || '';
      if (!found.points) continue;
      const candidate = compact([...start.points, ...found.points.slice(1), ...end.points.slice().reverse().slice(1)]);
      if (selfIntersects(candidate)) { lastReason = 'The available escape lanes would make this wire fold back over itself.'; continue; }
      path = candidate; break;
    }
    if (!path) {
      result.diagnostics.push(`No non-overlapping route is available. ${lastReason} Move components apart or free a routing lane.`.trim());
      return result;
    }
    result.points = path;
    result.crossings = occupied.crossings(path);
    result.status = result.crossings.length ? 'crossing' : 'ok';
    if (result.crossings.length) result.diagnostics.push('A wire crossing is required. Draw a bridge at the supplied crossing coordinates.');
    occupied.add(path, id);
    diagnostics.routed++;
    diagnostics.crossings += result.crossings.length;
    return result;
  }
  for (const plan of plans) {
    let route = routePlan(plan, plan.preferred);
    if (route.status === 'blocked' && plan.preferred !== plan.fine) route = routePlan(plan, plan.fine);
    if (route.status === 'blocked') diagnostics.blocked++;
    routes[plan.wire.id] = route;
  }
  return { routes, diagnostics, grid: boardGrid, gap: boardGap };
}

export default routeWires;
