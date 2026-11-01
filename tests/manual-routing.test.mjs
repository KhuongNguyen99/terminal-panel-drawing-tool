import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureManualRoute, moveWireSegment, normalizeManualRoute, resolveManualRoute } from '../dist/manual-routing.js';

const from = { x: 100, y: 100, side: 'right', escapeX: 120 };
const to = { x: 600, y: 300, side: 'left', escapeX: 530 };
const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 450, y: 200 }, { x: 450, y: 300 }, { x: 600, y: 300 }];
const options = { from, to, grid: 10, gap: 10 };
function assertOrthogonal(result, a = from, b = to) {
  assert.ok(result);
  assert.deepEqual(result[0], { x: a.x, y: a.y });
  assert.deepEqual(result.at(-1), { x: b.x, y: b.y });
  for (let i = 1; i < result.length; i++) {
    const previous = result[i - 1], p = result[i];
    assert.ok(previous.x === p.x || previous.y === p.y);
    assert.notDeepEqual(previous, p);
  }
}

test('horizontal and vertical interior segments move perpendicular and snap', () => {
  const horizontal = moveWireSegment(points, 2, 247, options);
  assertOrthogonal(horizontal);
  assert.deepEqual(horizontal.slice(2, 4), [{ x: 200, y: 250 }, { x: 450, y: 250 }]);
  const vertical = moveWireSegment(points, 1, 257, options);
  assertOrthogonal(vertical);
  assert.deepEqual(vertical.slice(1, 3), [{ x: 260, y: 100 }, { x: 260, y: 200 }]);
  const free = moveWireSegment(points, 2, 247.25, { ...options, snap: false });
  assert.equal(free[2].y, 247.25);
});

test('first and last segments add bends while keeping exact terminal endpoints', () => {
  const first = moveWireSegment(points, 0, 70, options);
  assertOrthogonal(first);
  assert.deepEqual(first.slice(0, 4), [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 70 }, { x: 200, y: 70 }]);
  const last = moveWireSegment(points, 4, 330, options);
  assertOrthogonal(last);
  assert.deepEqual(last.slice(-4), [{ x: 450, y: 330 }, { x: 530, y: 330 }, { x: 530, y: 300 }, { x: 600, y: 300 }]);
});

test('short terminal segments gain a movable lane without folding over their lead', () => {
  const a = { x: 100, y: 100, side: 'right', escapeX: 120 };
  const b = { x: 400, y: 200, side: 'left', escapeX: 380 };
  const short = [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 200 }, { x: 400, y: 200 }];
  const result = moveWireSegment(short, 0, 70, { from: a, to: b });
  assertOrthogonal(result, a, b);
  assert.deepEqual(result.slice(0, 5), [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 70 }, { x: 130, y: 70 }, { x: 130, y: 200 }]);
});

test('a straight wire can be shifted with doglegs at both terminals', () => {
  const a = { x: 100, y: 100, side: 'right', escapeX: 120 };
  const b = { x: 400, y: 100, side: 'left', escapeX: 380 };
  const result = moveWireSegment([{ x: 100, y: 100 }, { x: 400, y: 100 }], 0, 180, { from: a, to: b });
  assertOrthogonal(result, a, b);
  assert.deepEqual(result, [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 180 }, { x: 380, y: 180 }, { x: 380, y: 100 }, { x: 400, y: 100 }]);
});

test('adjacent vertical bends cannot be moved inside required terminal escapes', () => {
  const start = moveWireSegment(points, 1, 40, options);
  assert.equal(start[1].x, 120);
  const end = moveWireSegment(points, 3, 590, options);
  assert.equal(end.at(-2).x, 530);
});

test('unchanged endpoints retain the exact saved route, including off-grid ports', () => {
  const a = { x: 105.5, y: 113.25, side: 'right' }, b = { x: 600, y: 317.5, side: 'left' };
  const p = [{ x: a.x, y: a.y }, { x: 200, y: a.y }, { x: 200, y: 200 }, { x: 450, y: 200 }, { x: 450, y: b.y }, { x: b.x, y: b.y }];
  const manual = captureManualRoute(p, a, b);
  assert.deepEqual(resolveManualRoute(manual, a, b), p);
  assert.deepEqual(normalizeManualRoute(JSON.parse(JSON.stringify(manual))), manual);
});

test('moving both components together translates every manual bend', () => {
  const manual = captureManualRoute(points, from, to);
  const nextFrom = { ...from, x: from.x + 70, y: from.y - 30, escapeX: 190 };
  const nextTo = { ...to, x: to.x + 70, y: to.y - 30, escapeX: 600 };
  const result = resolveManualRoute(manual, nextFrom, nextTo);
  assertOrthogonal(result, nextFrom, nextTo);
  assert.deepEqual(result, points.map(p => ({ x: p.x + 70, y: p.y - 30 })));
});

test('moving one component adapts its terminal stub and preserves interior bends', () => {
  const manual = captureManualRoute(points, from, to);
  const nextFrom = { ...from, x: 220, y: 120, escapeX: 240 };
  const result = resolveManualRoute(manual, nextFrom, to);
  assertOrthogonal(result, nextFrom, to);
  assert.deepEqual(result.slice(0, 3), [{ x: 220, y: 120 }, { x: 240, y: 120 }, { x: 240, y: 200 }]);
  assert.deepEqual(result.slice(3), points.slice(3));
  const nextTo = { ...to, x: 400, y: 350, escapeX: 330 };
  const other = resolveManualRoute(manual, from, nextTo);
  assertOrthogonal(other, from, nextTo);
  assert.deepEqual(other.slice(-3), [{ x: 330, y: 200 }, { x: 330, y: 350 }, { x: 400, y: 350 }]);
});

test('short routes reconnect unequal endpoint motion and side changes orthogonally', () => {
  const old = captureManualRoute([{ x: 100, y: 100 }, { x: 400, y: 100 }], from, { x: 400, y: 100, side: 'left' });
  const moved = { x: 450, y: 160, side: 'left', escapeX: 430 };
  assertOrthogonal(resolveManualRoute(old, from, moved), from, moved);
  const flipped = { x: 100, y: 100, side: 'left', escapeX: 80 };
  assertOrthogonal(resolveManualRoute(captureManualRoute(points, from, to), flipped, to), flipped, to);
});

test('invalid, oversized and nonorthogonal imported routes are rejected', () => {
  const manual = captureManualRoute(points, from, to);
  for (const bad of [null, {}, { ...manual, points: null }, { ...manual, points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }, { ...manual, from: { x: 100, y: 100, side: 'top' } }, { ...manual, points: [...points.slice(0, -1), { x: Infinity, y: 300 }] }, { ...manual, points: Array.from({ length: 129 }, () => points[0]) }, { ...manual, points: points.map(p => ({ x: p.x + 1e6, y: p.y })) }]) assert.equal(normalizeManualRoute(bad), null);
  assert.equal(moveWireSegment(points, 10, 100, options), null);
  assert.equal(moveWireSegment(points, 1, NaN, options), null);
});

test('dragging never mutates the original route or port objects', () => {
  const frozen = Object.freeze(points.map(p => Object.freeze({ ...p })));
  const a = Object.freeze({ ...from }), b = Object.freeze({ ...to });
  const manual = captureManualRoute(frozen, a, b);
  Object.freeze(manual.from); Object.freeze(manual.to); manual.points.forEach(Object.freeze); Object.freeze(manual.points); Object.freeze(manual);
  assertOrthogonal(moveWireSegment(frozen, 2, 230, { from: a, to: b }));
  assertOrthogonal(resolveManualRoute(manual, a, b));
  assert.deepEqual(frozen, points);
});
