import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, boundsOf, compatiblePorts, geometry, normalizeProject } from '../dist/model.js';
import { routeWires } from '../dist/router.js';
import { routeWithPreferences } from '../dist/independent-routing.js';
import { captureManualRoute, moveWireSegment } from '../dist/manual-routing.js';

const type = MODULE_TYPES.DIN_TERMINAL;
const bank = (extra = {}) => ({ id: 'bank', kind: 'module', type: 'DIN_TERMINAL', name: 'DIN Solenoid Rail Terminal Block', rio: 'Panel A', slot: '', x: 400, y: 100, ...extra });
const project = (nodes, wires = []) => ({
  version: 1, title: 'Twenty-row terminal bank', nodes, wires,
  fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
  settings: { grid: 10, snap: true, autoRoute: false, defaultWidth: 2.5 },
});
const normalize = input => normalizeProject(input, MODULE_TYPES);
const wire = (id, from, to, extra = {}) => ({ id, from, to, color: '#202631', width: 2.5, ...extra });
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);

test('terminal bank has twenty complete rows with two independent connections per section', () => {
  assert.equal(type.label, 'DIN Solenoid Rail Terminal Block');
  assert.equal(type.rowCount, 20);
  assert.equal(type.terminalLayout, 'split-rows');
  assert.equal(type.connectorRole, 'terminal');
  assert.equal(type.ports.length, 80);
  assert.equal(new Set(type.ports.map(p => p.id)).size, 80);

  for (let channel = 0; channel < 20; channel++) {
    const row = type.ports.filter(p => p.channel === channel);
    assert.equal(row.length, 4);
    for (const side of ['left', 'right']) {
      const [upper, lower] = ['inner', 'middle'].map(signal => row.find(p => p.side === side && p.signal === signal));
      assert.ok(upper && lower, `row ${channel + 1} has both ${side} connections`);
      assert.equal(upper.id, `${side}-${channel + 1}-inner`);
      assert.equal(lower.id, `${side}-${channel + 1}-middle`);
      assert.equal(upper.x, lower.x, 'the two connectors stack vertically');
      assert.equal(upper.y, 140 + channel * 40, 'white connector stays in place');
      assert.equal(lower.y, 150 + channel * 40, 'black connector moves up one 10-unit grid step');
      assert.ok(upper.y + upper.hitRadius < lower.y - lower.hitRadius, 'click targets do not overlap');
      for (const p of [upper, lower]) {
        assert.equal(p.x % 20, 0);
        assert.equal(p.y % 10, 0);
        assert.equal(p.showLabel, false, 'canvas does not show color names');
        assert.doesNotMatch(p.label, /white|black/i);
        assert.equal(p.label, `S${channel + 1}`, 'both connectors and sides share the row name');
        assert.equal(p.connectionLabel, `S${channel + 1} · ${side === 'left' ? 'Left' : 'Right'} · ${p.signal === 'inner' ? 'Inner' : 'Middle'}`);
      }
    }
  }

  for (const side of ['left', 'right']) {
    const ports = type.ports.filter(p => p.side === side).sort((a, b) => a.y - b.y);
    assert.equal(ports.length, 40);
    for (let i = 1; i < ports.length; i++) {
      assert.ok(ports[i].y - ports[i - 1].y >= 10);
      assert.ok(ports[i].y - ports[i - 1].y > ports[i].hitRadius + ports[i - 1].hitRadius);
    }
  }
});

test('mirrored arrows address the four gray ports and preserve the approved contrasting styles', () => {
  const imageScale = type.body.w / 1140;
  const physicalColumns = { 'left-inner': [3, 460], 'left-middle': [2, 300], 'right-inner': [4, 657], 'right-middle': [5, 811] };
  for (const p of type.ports) {
    const [column, sourceX] = physicalColumns[`${p.side}-${p.signal}`];
    assert.equal(p.targetColumn, column);
    assert.ok(column > 1 && column < 6, 'yellow end ports are not used by these callouts');
    close(p.pinX, type.body.x + sourceX * imageScale, 'arrow target matches its physical column');
    assert.deepEqual(p.calloutPoints[0], { x: p.x, y: p.y });
    assert.deepEqual(p.calloutPoints.at(-1), { x: p.pinX, y: p.pinY });
    assert.equal(p.calloutPoints[1].y, p.y, 'horizontal lane remains at the connector height');
    assert.ok(p.side === 'left' ? p.calloutPoints[1].x < p.pinX : p.calloutPoints[1].x > p.pinX);
    assert.equal(p.arrowStyle.color, p.signal === 'inner' ? '#ffffff' : '#121619');
    assert.equal(p.arrowStyle.outline, '#000000');
    assert.ok(p.arrowStyle.outlineWidth > p.arrowStyle.width);
    close(p.arrowStyle.width / imageScale, 4.5, 'shaft uses the approved thicker preview weight');
    close(p.arrowStyle.headLength / imageScale, 12, 'head uses the approved thicker preview size');
  }
});

test('every arrow, arrowhead and visible dot remains inside its own physical row', () => {
  // Horizontal dividers measured from the approved PNG, independently of the
  // connection dots' regular grid spacing. The artwork's rows vary slightly.
  const dividers = [184, 242, 301, 359, 417, 475.5, 534, 592, 650, 708.5, 766, 824, 881, 939, 996, 1053, 1110.5, 1168, 1225.5, 1283, 1346.5];
  const scale = type.body.h / 1380;
  for (const p of type.ports) {
    const top = type.body.y + dividers[p.channel] * scale;
    const bottom = type.body.y + dividers[p.channel + 1] * scale;
    const points = p.calloutPoints;
    for (const point of points) {
      assert.ok(point.y - p.arrowStyle.outlineWidth / 2 > top, `${p.id} shaft stays below its top divider`);
      assert.ok(point.y + p.arrowStyle.outlineWidth / 2 < bottom, `${p.id} shaft stays above its bottom divider`);
    }
    const tip = points.at(-1), before = points.at(-2);
    const dx = tip.x - before.x, dy = tip.y - before.y, distance = Math.hypot(dx, dy);
    const baseY = tip.y - dy / distance * p.arrowStyle.headLength;
    const spreadY = Math.abs(dx / distance * p.arrowStyle.headHalfWidth) + p.arrowStyle.headOutlineWidth / 2;
    assert.ok(Math.min(tip.y, baseY - spreadY) > top, `${p.id} arrowhead stays in the row`);
    assert.ok(Math.max(tip.y, baseY + spreadY) < bottom, `${p.id} arrowhead stays in the row`);
    assert.ok(p.y - 5.5 > top && p.y + 5.5 < bottom, `${p.id} visible connection dot fits its row`);
  }
});

test('artwork proportions, header and routing bounds cover the complete bank', () => {
  const png = readFileSync(new URL(`../dist/${type.image}`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1140);
  assert.equal(png.readUInt32BE(20), 1380);
  assert.equal(png[25], 6, 'approved transparent RGBA artwork is retained');
  close(type.body.w / type.body.h, 1140 / 1380, 'artwork is not stretched');
  assert.ok(type.header.y + type.header.height < type.body.y);
  assert.ok(type.body.y + type.body.h <= type.height);

  const node = bank(), geo = geometry([node], MODULE_TYPES), b = boundsOf([node], MODULE_TYPES);
  assert.equal(Object.keys(geo.ports).length, 80);
  assert.ok(Object.values(geo.ports).every(p => p.connectorRole === 'terminal'));
  const body = geo.obstacles.find(o => o.id === node.id);
  const header = geo.obstacles.find(o => o.y === node.y + type.header.y);
  assert.ok(header && header.nodeId !== node.id, 'outward wire escapes cannot pass through the title');
  for (const p of type.ports) {
    assert.ok(node.x + p.pinX > body.x && node.x + p.pinX < body.x + body.width);
    assert.ok(node.y + p.pinY > body.y && node.y + p.pinY < body.y + body.height);
    assert.ok(node.x + p.x >= b.x && node.x + p.x <= b.x + b.width);
    assert.ok(node.y + p.y >= b.y && node.y + p.y <= b.y + b.height);
  }
  assert.ok(b.y < node.y + type.header.y && b.y + b.height > node.y + type.height);
});

test('terminal bank save/reopen preserves new endpoints and existing module compatibility', () => {
  const nodes = [
    bank({ name: 'DIN Rail Terminal Block' }),
    { id: 'io', kind: 'module', type: 'AI', name: 'AI', rio: 'RIO A', slot: '5', x: 1400, y: 100 },
    { id: 'resistor', kind: 'module', type: 'DIN_RESISTOR', name: 'Resistor bank', rio: 'Panel B', slot: '', x: 1400, y: 900 },
    { id: 'cable', kind: 'device', name: 'Sensor', cable: '17', wireCount: 2, wireSide: 'right', cableSide: 'left', x: 0, y: 220, colors: {} },
    { id: 'tag', kind: 'tag', name: 'TB20.1', wireSide: 'left', x: 1600, y: 600 },
    { id: 'label', kind: 'wire-label', name: 'Return', color: '#202631', x: 0, y: 1040 },
  ];
  const wires = [
    wire('cable-inner', 'cable:white', 'bank:left-1-inner', { color: '#ffffff' }),
    wire('cable-middle', 'cable:black', 'bank:left-1-middle'),
    wire('bank-io', 'bank:right-1-inner', 'io:ch0-minus'),
    wire('tag-last', 'tag:connector', 'bank:right-20-middle'),
    wire('label-last', 'label:right', 'bank:left-20-inner'),
    wire('resistor-last', 'resistor:top-1', 'bank:left-20-middle'),
  ];
  const saved = normalize(project(nodes, wires));
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(saved.wires.length, wires.length);
  assert.equal(saved.nodes.find(n => n.id === 'bank').type, 'DIN_TERMINAL');
  assert.equal(saved.nodes.find(n => n.id === 'bank').name, type.label, 'old default names update when reopened');
  assert.equal(normalize(project([bank({ name: 'Solenoid bank A' })])).nodes[0].name, 'Solenoid bank A', 'custom names remain intact');
  assert.equal('topRowName' in saved.nodes.find(n => n.id === 'bank'), false);
  assert.equal(saved.nodes.find(n => n.id === 'resistor').topRowName, 'TB10');
  assert.equal(saved.nodes.find(n => n.id === 'resistor').bottomRowName, 'TB11');

  const { ports } = geometry(saved.nodes, MODULE_TYPES);
  for (const w of saved.wires) assert.equal(compatiblePorts(ports[w.from], ports[w.to]), true);
  assert.equal(compatiblePorts(ports['bank:left-1-inner'], ports['bank:right-1-inner']), false);
  assert.throws(() => normalize(project(nodes, [wire('bad', 'cable:black', 'bank:left-21-inner')])), /missing or incompatible/);
  assert.throws(() => normalize(project(nodes, [
    wire('one', 'cable:black', 'bank:left-1-inner'), wire('two', 'bank:left-1-inner', 'io:ch0-minus'),
  ])), /terminal is connected more than once/);
});

test('all eighty connections have distinct outward routing lanes at grids 10 and 20', () => {
  const node = bank(), geo = geometry([node], MODULE_TYPES);
  const wires = [];
  for (const p of Object.values(geo.ports)) {
    const id = `source-${p.localId}`;
    geo.ports[id] = { id, nodeId: id, kind: 'device', side: p.side === 'left' ? 'right' : 'left', x: p.x + (p.side === 'left' ? -200 : 200), y: p.y };
    wires.push(wire(`wire-${p.localId}`, id, p.id));
  }
  for (const grid of [10, 20]) {
    const routed = routeWires({ ...geo, wires, grid, gap: Math.max(10, grid) });
    assert.equal(routed.diagnostics.blocked, 0, `grid ${grid}: every connector remains reachable`);
    assert.equal(routed.diagnostics.crossings, 0);
    assert.equal(routed.diagnostics.sharedSegments, 0, 'adjacent dots never collapse onto one escape lane');
    for (const w of wires) {
      const r = routed.routes[w.id], destination = geo.ports[w.to];
      assert.notEqual(r.status, 'blocked');
      assert.deepEqual(r.points.at(-1), { x: destination.x, y: destination.y });
      assert.ok(r.points.every(p => destination.side === 'left' ? p.x <= destination.x : p.x >= destination.x), `${w.id} stays outside the bank`);
    }
  }
});

test('saved and manual black cables reattach after the one-step port move on every grid', () => {
  for (const grid of [5, 10, 20]) for (const x of [400, 405, 410]) for (const y of [100, 105, 110, 115]) {
    const geo = geometry([bank({ x, y })], MODULE_TYPES);
    const legacyPorts = structuredClone(geo.ports), wires = [];
    for (const port of Object.values(geo.ports)) {
      const old = legacyPorts[port.id];
      if (port.signal === 'middle') old.y += 10;
      delete old.routingPitch;
      const id = `source-${port.localId}`;
      const source = { id, nodeId: id, kind: 'device', side: port.side === 'left' ? 'right' : 'left', x: port.x + (port.side === 'left' ? -200 : 200), y: old.y };
      geo.ports[id] = source;
      legacyPorts[id] = source;
      wires.push(wire(`wire-${port.localId}`, id, port.id));
    }
    const old = routeWires({ ...geo, ports: legacyPorts, wires, grid, gap: Math.max(10, grid) });
    assert.equal(old.diagnostics.blocked, 0);
    for (const [i, w] of wires.entries()) {
      w[i % 2 ? 'manual' : 'savedRoute'] = captureManualRoute(old.routes[w.id].points, legacyPorts[w.from], legacyPorts[w.to]);
    }
    const reopened = routeWithPreferences({ ...geo, wires, grid, gap: Math.max(10, grid) });
    assert.equal(reopened.diagnostics.blocked, 0, `grid ${grid}: old paths remain attached`);
    assert.equal(reopened.diagnostics.visited, 0, 'saved bends do not trigger a new route search');
    for (const w of wires) {
      const destination = geo.ports[w.to];
      assert.deepEqual(reopened.routes[w.id].points.at(-1), { x: destination.x, y: destination.y });
      if (destination.signal === 'inner') assert.deepEqual(reopened.routes[w.id].points, old.routes[w.id].points, 'white paths stay unchanged');
    }
  }
});

test('coarse placement snapping keeps short wire bends on the finer routing lanes', () => {
  const from = { x: 0, y: 0, side: 'right', escapeX: 10 };
  const to = { x: 200, y: 20, side: 'left', escapeX: 190 };
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 200, y: 20 }];
  const moved = moveWireSegment(points, 0, -11, { from, to, grid: 10, snapGrid: 20, gap: 10 });
  assert.deepEqual(moved, [from, { x: 10, y: 0 }, { x: 10, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, to].map(({x,y}) => ({x,y})));
});

test('blocked dense-terminal cables display the same attached path that was reserved', () => {
  const from = { id: 'source', nodeId: 'source', x: 0, y: 270, side: 'right' };
  const to = { id: 'black', nodeId: 'bank', x: 442, y: 260, side: 'left', routingPitch: 10 };
  const manual = captureManualRoute([{x:0,y:270},{x:100,y:270},{x:100,y:240},{x:420,y:240},{x:420,y:270},{x:442,y:270}], from, {...to,y:270});
  const input = { ports: [from,to], wires: [wire('black-cable','source','black',{manual})], grid:20, gap:20,
    obstacles:[{id:'bank',nodeId:'bank',x:442,y:100,width:780,height:960},{id:'block',x:200,y:230,width:40,height:20}] };
  const reserved = routeWires({...input,preserveBlockedRoutes:true});
  const displayed = routeWithPreferences(input);
  assert.equal(reserved.routes['black-cable'].status,'blocked');
  assert.equal(reserved.routes['black-cable'].points.at(-2).x,435);
  assert.deepEqual(displayed.routes['black-cable'].points,reserved.routes['black-cable'].points);
});
