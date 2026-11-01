import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWires } from '../dist/router.js';
import { routeWithPreferences } from '../dist/independent-routing.js';
import { captureManualRoute, normalizeManualRoute, moveWireSegment, resolveManualRoute } from '../dist/manual-routing.js';

const near = (a, b) => Math.abs(a - b) < 1e-5;
const axis = p => ['top', 'bottom'].includes(p.side) ? 'y' : 'x';
const sign = p => ['left', 'top'].includes(p.side) ? -1 : 1;
function assertPath(points, from, to) {
  assert.ok(points?.length >= 2);
  assert.deepEqual(points[0], { x: from.x, y: from.y });
  assert.deepEqual(points.at(-1), { x: to.x, y: to.y });
  for (let i = 1; i < points.length; i++) {
    assert.ok(near(points[i - 1].x, points[i].x) || near(points[i - 1].y, points[i].y));
    assert.notDeepEqual(points[i - 1], points[i]);
  }
  for (const [p, adjacent] of [[from, points[1]], [to, points.at(-2)]]) {
    const normal = axis(p), cross = normal === 'x' ? 'y' : 'x';
    assert.ok(near(adjacent[cross], p[cross]));
    assert.ok((adjacent[normal] - p[normal]) * sign(p) > 0, `${p.side} lead must point outward`);
  }
}
function assertRouted(route, from, to) {
  assert.notEqual(route.status, 'blocked', route.diagnostics.join(' '));
  assertPath(route.points, from, to);
}
function hitsRect(points, rect) {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    return near(a.y, b.y)
      ? a.y > rect.y && a.y < rect.y + rect.height && Math.min(Math.max(a.x, b.x), rect.x + rect.width) > Math.max(Math.min(a.x, b.x), rect.x)
      : a.x > rect.x && a.x < rect.x + rect.width && Math.min(Math.max(a.y, b.y), rect.y + rect.height) > Math.max(Math.min(a.y, b.y), rect.y);
  });
}
function portOn(rect, side, id, offset = 0) {
  return { id, nodeId: rect.id, side,
    x: side === 'left' ? rect.x : side === 'right' ? rect.x + rect.width : rect.x + rect.width / 2 + offset,
    y: side === 'top' ? rect.y : side === 'bottom' ? rect.y + rect.height : rect.y + rect.height / 2 + offset };
}

for (const aSide of ['left', 'right', 'top', 'bottom']) for (const bSide of ['left', 'right', 'top', 'bottom']) {
  test(`automatic routing respects ${aSide} → ${bSide} port normals and off-grid endpoints`, () => {
    const rectA = { id: 'a-node', x: 0, y: 0, width: 120, height: 100 };
    const rectB = { id: 'b-node', x: 400, y: 300, width: 200, height: 120 };
    const a = portOn(rectA, aSide, 'a', 3.5), b = portOn(rectB, bSide, 'b', 7.25);
    const result = routeWires({ ports: [a, b], obstacles: [rectA, rectB], wires: [{ id: 'w', from: a.id, to: b.id }] });
    assertRouted(result.routes.w, a, b);
    assert.equal(hitsRect(result.routes.w.points, rectA), false);
    assert.equal(hitsRect(result.routes.w.points, rectB), false);
    assert.ok(captureManualRoute(result.routes.w.points, a, b), 'the route can be persisted without losing a vertical anchor');
  });
}

test('all 20 top/bottom terminals can route independently with separate escape lanes', () => {
  const ports = [], wires = [];
  for (const row of ['top', 'bottom']) for (let i = 0; i < 10; i++) {
    const x = 230 + i * 40, top = row === 'top';
    ports.push({ id: `${row}-source-${i}`, x, y: top ? 0 : 800, side: top ? 'bottom' : 'top' });
    ports.push({ id: `${row}-${i}`, nodeId: 'bank', x, y: top ? 200 : 600, side: row });
    wires.push({ id: `${row}-wire-${i}`, from: `${row}-source-${i}`, to: `${row}-${i}` });
  }
  const result = routeWires({ ports, wires, obstacles: [{ id: 'bank', x: 200, y: 200, width: 440, height: 400 }] });
  assert.equal(result.diagnostics.blocked, 0);
  assert.equal(result.diagnostics.routed, 20);
  for (let i = 0; i < wires.length; i++) assertRouted(result.routes[wires[i].id], ports[i * 2], ports[i * 2 + 1]);
});

test('a separate obstruction over a top escape blocks it, while its own header is cleared', () => {
  const from = { id: 'device', x: 50, y: 40, side: 'right' };
  const to = { id: 'terminal', nodeId: 'bank', x: 400, y: 200, side: 'top' };
  const owners = [{ id: 'body', nodeId: 'bank', x: 300, y: 200, width: 200, height: 300 },
    { id: 'header', nodeId: 'bank', x: 300, y: 150, width: 200, height: 35 }];
  const wire = { id: 'w', from: from.id, to: to.id };
  const clear = routeWires({ ports: [from, to], wires: [wire], obstacles: owners }).routes.w;
  assertRouted(clear, from, to);
  assert.ok(clear.points.at(-2).y < 150);
  const blocked = routeWires({ ports: [from, to], wires: [wire], obstacles: [...owners, { id: 'cover', x: 390, y: 180, width: 20, height: 20 }] }).routes.w;
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.diagnostics.join(' '), /outward connection/);
});

const a = { x: 100, y: 100, side: 'right', escapeX: 120 };
const b = { x: 400, y: 400, side: 'top', escapeY: 380 };
const mixed = [{ x: 100, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 260 }, { x: 400, y: 260 }, { x: 400, y: 400 }];
const opts = { from: a, to: b, grid: 10 };

test('mixed side anchors survive JSON and reject incorrectly directed terminal leads', () => {
  const saved = captureManualRoute(mixed, a, b);
  assert.ok(saved);
  assert.deepEqual(normalizeManualRoute(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(normalizeManualRoute({ ...saved, to: { ...saved.to, side: 'bottom' } }), null);
  assert.equal(normalizeManualRoute({ ...saved, to: { ...saved.to, side: 'diagonal' } }), null);
});

test('mixed endpoint segments move independently and stay attached with outward doglegs', () => {
  const first = moveWireSegment(mixed, 0, 70, opts);
  assertPath(first, a, b);
  assert.deepEqual(first.slice(0, 4), [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 70 }, { x: 180, y: 70 }]);
  const last = moveWireSegment(mixed, 3, 450, opts);
  assertPath(last, a, b);
  assert.deepEqual(last.slice(-4), [{ x: 450, y: 260 }, { x: 450, y: 380 }, { x: 400, y: 380 }, { x: 400, y: 400 }]);
  const moved = moveWireSegment(mixed, 2, 395, opts);
  assertPath(moved, a, b);
  assert.equal(moved.at(-2).y, 380, 'adjacent horizontal segment stops outside the top terminal escape');
  assertPath(moveWireSegment(mixed, 3, 450), a, b);
});

test('a short mixed L-shaped lead can be dragged without moving the vertical terminal', () => {
  const from = { x: 100, y: 100, side: 'right', escapeX: 120 };
  const to = { x: 120, y: 300, side: 'top', escapeY: 280 };
  const p = [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 300 }];
  const moved = moveWireSegment(p, 0, 70, { from, to });
  assertPath(moved, from, to);
  assert.deepEqual(moved.at(-2), { x: 120, y: 280 });
});

test('vertical straight-wire segments gain doglegs at both unchanged endpoints', () => {
  const from = { x: 100, y: 100, side: 'bottom', escapeY: 120 };
  const to = { x: 100, y: 400, side: 'top', escapeY: 380 };
  const moved = moveWireSegment([{ x: 100, y: 100 }, { x: 100, y: 400 }], 0, 180, { from, to });
  assertPath(moved, from, to);
  assert.deepEqual(moved, [{ x: 100, y: 100 }, { x: 100, y: 120 }, { x: 180, y: 120 }, { x: 180, y: 380 }, { x: 100, y: 380 }, { x: 100, y: 400 }]);
});

test('moving a top endpoint keeps the unrelated manual bend and shared moves translate every point', () => {
  const saved = captureManualRoute(mixed, a, b);
  const to = { ...b, x: 450, y: 500, escapeY: 480 };
  const moved = resolveManualRoute(saved, a, to);
  assertPath(moved, a, to);
  assert.deepEqual(moved.slice(0, 3), mixed.slice(0, 3));
  const fromMoved = { ...a, x: a.x + 40, y: a.y - 30, escapeX: 160 };
  const toMoved = { ...b, x: b.x + 40, y: b.y - 30, escapeY: 350 };
  assert.deepEqual(resolveManualRoute(saved, fromMoved, toMoved), mixed.map(p => ({ x: p.x + 40, y: p.y - 30 })));
});

test('every mixed-side orientation supports each segment drag and moved endpoint', () => {
  const rotate = p => ({ x: -p.y, y: p.x });
  const nextSide = { left: 'top', top: 'right', right: 'bottom', bottom: 'left' };
  const rotatePort = p => ({ ...rotate(p), side: nextSide[p.side],
    ...(p.escapeX != null ? { escapeY: p.escapeX } : {}),
    ...(p.escapeY != null ? { escapeX: -p.escapeY } : {}) });
  let from = a, to = b, points = mixed;
  for (let turn = 0; turn < 4; turn++) {
    const saved = captureManualRoute(points, from, to);
    for (let i = 0; i < points.length - 1; i++) {
      const horizontal = points[i].y === points[i + 1].y;
      const coordinate = (horizontal ? points[i].y : points[i].x) + 30;
      assertPath(moveWireSegment(points, i, coordinate, { from, to }), from, to);
    }
    const moved = { ...to, x: to.x + 20, y: to.y + 30 };
    if (moved.escapeX != null) moved.escapeX += 20;
    if (moved.escapeY != null) moved.escapeY += 30;
    assertPath(resolveManualRoute(saved, from, moved), from, moved);
    const routed = routeWires({ ports: [{ ...from, id: 'a' }, { ...to, id: 'b' }],
      wires: [{ id: 'w', from: 'a', to: 'b', manual: saved }] }).routes.w;
    assertRouted(routed, from, to);
    from = rotatePort(from); to = rotatePort(to); points = points.map(rotate);
  }
});

test('saved vertical wires reopen unchanged and moving one connection leaves the other wire fixed', () => {
  const from = { id: 'a', ...a }, to = { id: 'b', ...b };
  const otherFrom = { id: 'c', x: 600, y: 100, side: 'bottom' };
  const otherTo = { id: 'd', x: 600, y: 400, side: 'top' };
  const wires = [{ id: 'one', from: 'a', to: 'b' }, { id: 'two', from: 'c', to: 'd' }];
  const first = routeWithPreferences({ wires, ports: [from, to, otherFrom, otherTo] });
  assert.equal(first.diagnostics.blocked, 0);
  const saved = JSON.parse(JSON.stringify(wires.map(w => ({ ...w, savedRoute: first.savedRoutes[w.id] }))));
  const reopened = routeWithPreferences({ wires: saved, ports: [from, to, otherFrom, otherTo] });
  assert.deepEqual(reopened.routes.one.points, first.routes.one.points);
  assert.deepEqual(reopened.routes.two.points, first.routes.two.points);
  const moved = routeWithPreferences({ wires: saved, ports: [from, { ...to, x: 450, y: 450 }, otherFrom, otherTo] });
  assert.equal(moved.diagnostics.blocked, 0);
  assert.deepEqual(moved.routes.two.points, first.routes.two.points);
  assertRouted(moved.routes.one, from, { ...to, x: 450, y: 450 });
});

test('a new bottom wire avoids a fixed top wire even when the new port escape conflicts with it', () => {
  const black = { id: 'black', nodeId: 'device', x: 560, y: 700, side: 'right' };
  const white = { id: 'white', nodeId: 'device', x: 560, y: 720, side: 'right' };
  const top = { id: 'top', nodeId: 'bank', x: 180, y: -20, side: 'top' };
  const bottom = { id: 'bottom', nodeId: 'bank', x: 180, y: 630, side: 'bottom' };
  const fixedPoints = [{ x: 560, y: 700 }, { x: 570, y: 700 }, { x: 570, y: 640 },
    { x: 130, y: 640 }, { x: 130, y: -30 }, { x: 180, y: -30 }, { x: 180, y: -20 }];
  const input = {
    ports: [black, white, top, bottom],
    obstacles: [{ id: 'device', x: 350, y: 680, width: 210, height: 60 },
      { id: 'bank', x: 140, y: 0, width: 600, height: 620 }],
    wires: [{ id: 'black-wire', from: black.id, to: top.id, savedRoute: captureManualRoute(fixedPoints, black, top) },
      { id: 'white-wire', from: white.id, to: bottom.id }],
    autoRoute: false,
  };
  const overlaps = (one, two) => one.slice(1).some((b, i) => two.slice(1).some((d, j) => {
    const a = one[i], c = two[j], horizontal = near(a.y, b.y);
    if (horizontal !== near(c.y, d.y)) return false;
    const normal = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
    return near(a[cross], c[cross]) && Math.min(Math.max(a[normal], b[normal]), Math.max(c[normal], d[normal])) > Math.max(Math.min(a[normal], b[normal]), Math.min(c[normal], d[normal]));
  }));
  const result = routeWithPreferences({ ...input, rerouteIds: ['white-wire'] });
  assert.equal(result.routes['black-wire'].status, 'blocked', 'the new port-escape conflict remains explicit');
  assert.deepEqual(result.routes['black-wire'].points, fixedPoints, 'the old wire stays exactly where the user put it');
  assert.match(result.routes['black-wire'].diagnostics.join(' '), /port connection/);
  assertRouted(result.routes['white-wire'], white, bottom);
  assert.equal(overlaps(fixedPoints, result.routes['white-wire'].points), false);
  assert.ok(result.routes['white-wire'].crossings.some(c => c.otherWireId === 'black-wire' && c.x === 180 && c.y === 640), 'the new wire draws a bridge at the unavoidable crossing');
  const reopened = routeWithPreferences({ ...input, wires: input.wires.map(w => ({ ...w, savedRoute: result.savedRoutes[w.id] || w.savedRoute })) });
  assert.deepEqual(reopened.routes['black-wire'].points, fixedPoints);
  assert.deepEqual(reopened.routes['white-wire'].points, result.routes['white-wire'].points);
  assert.equal(overlaps(reopened.routes['black-wire'].points, reopened.routes['white-wire'].points), false);
});
