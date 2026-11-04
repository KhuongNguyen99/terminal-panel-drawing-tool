import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { CONDUCTORS, FOUR_WIRE_ORDER_REVISION, DEVICE_WIDTH, DEVICE_HEIGHT, DEVICE_MIN_WIDTH, DEVICE_MAX_WIDTH, DEVICE_MAX_HEIGHT,
  MAX_PROJECT_NODES, MAX_PROJECT_WIRES, POSITION_MIN, POSITION_MAX, canAddToProject, positionInBounds, clampPosition,
  applyCompactLabelSize, applyFourWireOrder, deviceMinHeight, deviceWidth, deviceHeight, devicePortY, geometry, normalizeProject, boundsOf, escapeXML, safeColor } from '../dist/model.js';

const device = (extra = {}) => ({ id: 'device-1', kind: 'device', name: '*v-3501#-y-pos', cable: '17', x: 40, y: 100, wireCount: 2, cableSide: 'left', wireSide: 'right', colors: {}, ...extra });
const module = (extra = {}) => ({ id: 'module-1', kind: 'module', type: 'AI', name: 'Analog input', slot: '5', rio: 'RIO A', x: 500, y: 30, ...extra });
const wire = (extra = {}) => ({ id: 'wire-1', from: 'device-1:black', to: 'module-1:ch0-minus', color: '#202631', width: 2.5, ...extra });
const project = (extra = {}) => ({ version: 1, title: 'RIO A · Slot 5', fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION, nodes: [device(), module()], wires: [wire()], settings: { grid: 10, snap: true, defaultWidth: 2.5 }, ...extra });
const normalize = value => normalizeProject(value, MODULE_TYPES);

test('editable project survives JSON save/reopen without changing its normalized wiring', () => {
  const first = normalize(project({ nodes: [device({ name: 'Valve "A" <test> & return', cable: 'C-017' }), module()] }));
  const reopened = normalize(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(reopened, first);
  assert.equal(reopened.nodes[1].slot, '5');
  assert.equal(reopened.wires[0].to, 'module-1:ch0-minus');
});

test('every module port uses its template geometry and correct side connection anchors', () => {
  for (const [type, template] of Object.entries(MODULE_TYPES)) {
    const n = module({ type, x: 120, y: -80 });
    const { ports, obstacles } = geometry([n], MODULE_TYPES);
    assert.equal(Object.keys(ports).length, template.ports.length);
    for (const p of Object.values(ports)) {
      const local = template.ports.find(local => local.id === p.localId);
      assert.equal(p.x, n.x + local.x, `${type} ${p.localId} template anchor`);
      assert.equal(p.y, n.y + local.y);
      if (['left', 'right'].includes(p.side)) {
        if (type === 'DIN_TERMINAL') {
          assert.equal(local.x, p.side === 'left' ? 40 : 820, 'wide terminal bank uses its approved external dots');
          assert.equal(local.y, (local.signal === 'inner' ? 140 : 150) + local.channel * 40, 'black bank connectors sit one 10-unit step below white');
          assert.equal(local.showLabel, false, 'terminal bank labels belong to connector pairs');
        } else {
          assert.equal(local.x, p.side === 'left' ? 60 : template.width - 60, 'existing I/O anchors stay outside their channel labels');
        }
      }
      assert.equal(p.kind, 'module');
      assert.equal(p.nodeId, n.id);
    }
    if (!template.routingObstacles) {
      assert.ok(obstacles[0].y < n.y, 'module title is inside routing obstacle');
      assert.equal(obstacles[0].width, template.width);
    }
  }
});

test('RTD channel labels and contact rows match the corrected physical terminals', () => {
  const ports = MODULE_TYPES.AI_RTD.ports;
  assert.equal(ports.length, 16);
  const expected = {
    left: ['CH0 M+', 'CH2 M+', 'CH0 M-', 'CH2 M-', 'CH0 I+', 'CH2 I+', 'CH0 I-', 'CH2 I-'],
    right: ['CH1 M+', 'CH3 M+', 'CH1 M-', 'CH3 M-', 'CH1 I+', 'CH3 I+', 'CH1 I-', 'CH3 I-'],
  };
  const photoRows = [311, 330, 348, 367, 386, 405, 424, 443];
  for (const side of ['left', 'right']) {
    const sidePorts = ports.filter(p => p.side === side);
    assert.deepEqual(sidePorts.map(p => p.label), expected[side]);
    for (const [row, p] of sidePorts.entries()) {
      assert.equal(p.id, `ch${p.channel}-${p.signal.replace('+', 'plus').replace('-', 'minus').toLowerCase()}`);
      assert.equal(p.y, 310 + row * 20);
      assert.equal(p.pinY, photoRows[row] * 480 / 486);
      assert.equal(p.x, side === 'left' ? 60 : 300);
    }
  }
  for (let ch = 0; ch < 4; ch++) {
    const channelPorts = ports.filter(p => p.channel === ch);
    assert.equal(channelPorts.length, 4);
    assert.deepEqual(new Set(channelPorts.map(p => p.signal)), new Set(['M+', 'M-', 'I+', 'I-']));
    assert.ok(channelPorts.every(p => p.side === (ch % 2 ? 'right' : 'left')));
    assert.equal(new Set(channelPorts.map(p => p.y)).size, 4);
  }
});

test('saved RTD wire endpoint IDs reopen on the corrected channel contacts', () => {
  const saved = project({
    nodes: [
      device({ id: 'device-1', wireCount: 4 }),
      device({ id: 'device-2', y: 300, wireCount: 4 }),
      module({ type: 'AI_RTD' }),
    ],
    wires: [
      wire({ id: 'ch1-wire', from: 'device-1:red', to: 'module-1:ch1-mplus' }),
      wire({ id: 'ch2-wire', from: 'device-2:red', to: 'module-1:ch2-mplus' }),
    ],
  });
  const reopened = normalize(JSON.parse(JSON.stringify(normalize(saved))));
  assert.deepEqual(reopened.wires.map(w => w.to), ['module-1:ch1-mplus', 'module-1:ch2-mplus']);
  const { ports } = geometry(reopened.nodes, MODULE_TYPES);
  assert.deepEqual(['ch1-mplus', 'ch2-mplus'].map(id => {
    const p = ports[`module-1:${id}`];
    return [p.label, p.side, p.x, p.y];
  }), [
    ['CH1 M+', 'right', 800, 340],
    ['CH2 M+', 'left', 560, 360],
  ]);
});

test('standard AI, DQ, AQ and Ex-AI preserve all annotated channel assignments', () => {
  assert.equal(MODULE_TYPES.AI.ports.length, 16);
  for (let ch = 0; ch < 8; ch++) {
    const pair = MODULE_TYPES.AI.ports.filter(p => p.channel === ch);
    assert.deepEqual(pair.map(p => p.signal), ['-', '+']);
    assert.ok(pair.every(p => p.side === (ch % 2 ? 'right' : 'left')));
  }
  assert.equal(MODULE_TYPES.DQ.ports.filter(p => p.signal === '+').length, 8);
  assert.equal(MODULE_TYPES.DQ.ports.filter(p => p.signal === '0V').length, 8);
  for (const type of ['AQ', 'EX_AI']) {
    assert.equal(MODULE_TYPES[type].ports.length, 4);
    for (let ch = 0; ch < 2; ch++) {
      const pair = MODULE_TYPES[type].ports.filter(p => p.channel === ch);
      assert.deepEqual(new Set(pair.map(p => p.signal)), new Set(['-', '+']));
      assert.ok(pair.every(p => p.side === (ch ? 'right' : 'left')));
    }
  }
});

test('2-wire and 4-wire ports keep conductor identity when changed or flipped', () => {
  const n = device({ x: 50, y: 70 });
  const two = geometry([n], MODULE_TYPES).ports;
  const four = geometry([{ ...n, wireCount: 4 }], MODULE_TYPES).ports;
  assert.deepEqual(Object.keys(two), ['device-1:black', 'device-1:white']);
  assert.deepEqual(Object.keys(four), ['device-1:red', 'device-1:black', 'device-1:white', 'device-1:green']);
  assert.deepEqual(Object.values(two).map(p => [p.x, p.y]), [[260, 90], [260, 110]]);
  Object.values(four).forEach((p, i) => assert.ok(Math.abs(p.y - [80, 70 + 70 / 3, 70 + 110 / 3, 120][i]) < 1e-8));
  assert.equal(deviceHeight(n), 60);
  assert.equal(deviceHeight({ ...n, wireCount: 4 }), 60);
  const left = geometry([{ ...n, wireSide: 'left' }], MODULE_TYPES).ports;
  assert.deepEqual(Object.keys(left), Object.keys(two));
  assert.ok(Object.values(left).every(p => p.x === 50 && p.side === 'left'));
  assert.ok(Object.values(two).every(p => p.x === 50 + DEVICE_WIDTH && p.side === 'right'));
});

test('custom label size moves wire endpoints with the label edge and resizes its routing obstacle', () => {
  const n = device({ x: 50, y: 70, width: 420, height: 160 });
  const { ports, obstacles } = geometry([n], MODULE_TYPES);
  assert.deepEqual(Object.values(ports).map(p => [p.localId, p.x, p.y]), [['black', 470, 90], ['white', 470, 210]]);
  assert.deepEqual(obstacles[0], { id: n.id, nodeId: n.id, x: 50, y: 70, width: 420, height: 160 });
  const four = { ...n, wireCount: 4, wireSide: 'left' };
  const left = Object.values(geometry([four], MODULE_TYPES).ports);
  assert.deepEqual(left.map(p => p.localId), ['red', 'black', 'white', 'green']);
  assert.ok(left.every(p => p.x === 50 && p.side === 'left'));
  assert.deepEqual(left.map(p => p.y), [90, 130, 170, 210]);
  const minimum = { ...four, height: 80 };
  assert.deepEqual([0, 1, 2, 3].map(i => devicePortY(minimum, i)), [10, 30, 50, 70]);
  assert.deepEqual([0, 1, 2, 3].map(i => devicePortY({ ...four, height: 100 }, i)), [20, 40, 60, 80]);
  for (const height of [60, 61, 80, 81, 100, 125, 600]) {
    const ys = [0, 1, 2, 3].map(i => devicePortY({ ...four, height }, i));
    assert.ok(ys[0] >= 10 && ys[3] <= height - 10, 'ports keep a margin from the corners');
    const ports = Object.values(geometry([{ ...four, height }], MODULE_TYPES).ports);
    assert.ok(ports.every(p => p.hitRadius >= 6 && p.hitRadius <= 13));
    assert.ok(ports.slice(1).every((p, i) => p.y - ports[i].y > p.hitRadius + ports[i].hitRadius), 'adjacent conductor hit targets never overlap');
  }
});

test('custom dimensions survive saved-project roundtrips without changing conductor connections', () => {
  const first = normalize(project({ nodes: [device({ width: 385, height: 175 }), module()] }));
  assert.equal(first.nodes[0].width, 385);
  assert.equal(first.nodes[0].height, 175);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(first))), first);
  assert.equal(first.wires[0].from, 'device-1:black');
  assert.equal(first.wires[0].to, 'module-1:ch0-minus');
});

test('implicit label dimensions use 210 by 60 for both conductor options', () => {
  const old = normalize(project()).nodes[0];
  assert.equal(Object.hasOwn(old, 'width'), false);
  assert.equal(Object.hasOwn(old, 'height'), false);
  assert.equal(deviceWidth(old), 210);
  assert.equal(deviceHeight(old), 60);
  assert.equal(deviceHeight({ ...old, wireCount: 4 }), 60);
  assert.equal(deviceMinHeight(old), 1);
  assert.equal(deviceMinHeight({ ...old, wireCount: 4 }), 1);
  assert.equal(DEVICE_WIDTH, 210);
  assert.equal(DEVICE_HEIGHT, 60);
});

test('imported label dimensions are finite, bounded integers with safe fallbacks', () => {
  const read = extra => normalize(project({ nodes: [device(extra), module()] })).nodes[0];
  assert.deepEqual([read({ width: '385.6', height: '175.2' }).width, read({ width: '385.6', height: '175.2' }).height], [386, 175]);
  const minimum = read({ width: -200, height: 0 });
  assert.equal(minimum.width, DEVICE_MIN_WIDTH);
  assert.equal(minimum.height, 1);
  assert.equal(read({ wireCount: 4, height: 1 }).height, 1);
  const maximum = read({ width: 1e20, height: 1e20 });
  assert.equal(maximum.width, DEVICE_MAX_WIDTH);
  assert.equal(maximum.height, DEVICE_MAX_HEIGHT);
  for (const invalid of [Infinity, -Infinity, NaN, 'not-a-size', {}, [], true]) {
    const n = read({ width: invalid, height: invalid });
    assert.equal(n.width, 210);
    assert.equal(n.height, 60);
    assert.ok(Object.values(geometry([n], MODULE_TYPES).ports).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

test('compact label update sizes every existing device once and preserves other data', () => {
  const input = project({ nodes: [device({ width: 360, height: 140 }), device({ id: 'device-2', wireCount: 4, width: 420, height: 100 }), module()] });
  const beforeWires = structuredClone(input.wires), beforeModule = structuredClone(input.nodes[2]);
  assert.equal(applyCompactLabelSize(input), true);
  assert.equal(input.labelSizeRevision, '210x60-v1');
  assert.deepEqual(input.nodes.slice(0, 2).map(n => [n.width, n.height]), [[210, 60], [210, 60]]);
  assert.deepEqual(input.wires, beforeWires);
  assert.deepEqual(input.nodes[2], beforeModule);
  input.nodes[0].width = 325;
  input.nodes[0].height = 90;
  assert.equal(applyCompactLabelSize(input), false);
  const reopened = normalize(JSON.parse(JSON.stringify(input)));
  assert.equal(reopened.labelSizeRevision, '210x60-v1');
  assert.equal(applyCompactLabelSize(reopened), false);
  assert.equal(reopened.nodes[0].width, 325);
  assert.equal(reopened.nodes[0].height, 90);
});

test('export bounds include the entire resized device label', () => {
  const n = device({ x: 50, y: 80, width: 700, height: 400 });
  assert.deepEqual(boundsOf([n], MODULE_TYPES), { x: 41, y: 71, width: 718, height: 418 });
});

test('changing a 4-wire project to 2-wire retains valid black/white IDs and rejects stale red/green connections', () => {
  const source = project({ nodes: [device({ wireCount: 4 }), module()], wires: [wire(), wire({ id: 'wire-2', from: 'device-1:white', to: 'module-1:ch0-plus', color: '#ffffff' })] });
  const four = normalize(source);
  source.nodes[0].wireCount = 2;
  const two = normalize(source);
  assert.deepEqual(two.wires, four.wires);
  for (const conductor of ['red', 'green']) {
    assert.throws(() => normalize({ ...source, wires: [wire({ from: `device-1:${conductor}` })] }), /missing|incompatible|terminal/i);
  }
});

test('module-to-device input connections normalize to the canonical device-to-module direction', () => {
  const result = normalize(project({ wires: [wire({ from: 'module-1:ch0-minus', to: 'device-1:black' })] }));
  assert.equal(result.wires[0].from, 'device-1:black');
  assert.equal(result.wires[0].to, 'module-1:ch0-minus');
});

const manualRoute = () => ({
  points: [{ x: 250, y: 120 }, { x: 320, y: 120 }, { x: 320, y: 340 }, { x: 560, y: 340 }],
  from: { x: 250, y: 120, side: 'right' },
  to: { x: 560, y: 340, side: 'left' },
});

function legacyFourWireProject(wireSide = 'right', wireCount = 4) {
  const four = device({ wireCount, wireSide, width: 210, height: 100, x: wireSide === 'left' ? 900 : 40, colors: { red: '#A12345', black: '#121212' } });
  const two = device({ id: 'device-2', wireSide, x: four.x, y: 700, colors: { black: '#123abc', white: '#FFFFFF' } });
  const m = module({ x: wireSide === 'left' ? 400 : 600 });
  const ports = geometry([m], MODULE_TYPES).ports;
  const channels = wireSide === 'left' ? [1, 3, 7] : [0, 2, 6];
  const roles = ['red', 'black', 'green', 'white'];
  const colors = ['#A12345', '#121212', '#2b9b68', '#ffffff'];
  const wires = roles.map((role, i) => {
    const from = { x: four.x + (wireSide === 'right' ? 210 : 0), y: four.y + devicePortY(four, i), side: wireSide };
    const target = `${m.id}:ch${channels[Math.floor(i / 2)]}-${i % 2 ? 'plus' : 'minus'}`;
    const to = { x: ports[target].x, y: ports[target].y, side: ports[target].side };
    const route = offset => ({
      points: [{ x: from.x, y: from.y }, { x: (from.x + to.x) / 2 + offset, y: from.y }, { x: (from.x + to.x) / 2 + offset, y: to.y }, { x: to.x, y: to.y }],
      from: { ...from }, to: { ...to },
    });
    return wire({ id: `four-${role}`, from: `${four.id}:${role}`, to: target, color: colors[i], width: 4, manual: route(0), savedRoute: route(20) });
  });
  wires.push(
    wire({ id: 'two-black', from: `${two.id}:black`, to: `${m.id}:ch${channels[2]}-minus`, color: '#123abc' }),
    wire({ id: 'two-white', from: `${two.id}:white`, to: `${m.id}:ch${channels[2]}-plus`, color: '#FFFFFF' }),
  );
  const input = project({ nodes: [four, two, m], wires });
  delete input.fourWireOrderRevision;
  return input;
}

test('legacy four-wire colors swap once without moving terminals, channels, or saved bends', () => {
  for (const side of ['left', 'right']) for (const count of [4, '4']) {
    const input = legacyFourWireProject(side, count), before = structuredClone(input);
    const unchanged = normalize({ ...input, fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION });
    const result = normalize(input), ports = geometry(result.nodes, MODULE_TYPES).ports;
    assert.equal(result.fourWireOrderRevision, FOUR_WIRE_ORDER_REVISION);
    assert.deepEqual(input, before, 'importing must not mutate source data');
    assert.deepEqual({ ...result.nodes[0], colors: undefined }, { ...unchanged.nodes[0], colors: undefined });
    assert.deepEqual(result.nodes.slice(1), unchanged.nodes.slice(1), 'two-wire devices and modules remain unchanged');
    assert.deepEqual(result.nodes[0].colors, { red: '#A12345', black: '#121212', white: '#ffffff', green: '#2b9b68' });
    for (const original of before.wires) {
      const next = result.wires.find(w => w.id === original.id);
      if (original.id.startsWith('two-') || original.id === 'four-red' || original.id === 'four-black') {
        assert.deepEqual(next, unchanged.wires.find(w => w.id === original.id));
      }
      if (!original.id.startsWith('four-')) continue;
      const oldRole = original.from.split(':')[1];
      const newRole = oldRole === 'green' ? 'white' : oldRole === 'white' ? 'green' : oldRole;
      assert.equal(next.from, `device-1:${newRole}`);
      assert.equal(next.to, original.to, 'the connected module terminal does not change');
      assert.equal(next.width, original.width);
      assert.equal(next.color, oldRole === 'green' ? '#ffffff' : oldRole === 'white' ? '#2b9b68' : original.color);
      assert.deepEqual(next.manual, original.manual);
      assert.deepEqual(next.savedRoute, original.savedRoute);
      assert.deepEqual({ x: ports[next.from].x, y: ports[next.from].y, side: ports[next.from].side }, original.manual.from, 'the recolored conductor retains its physical position');
    }
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result, 'save/open must not swap again');
    const reapplied = structuredClone(result);
    applyFourWireOrder(reapplied);
    assert.deepEqual(reapplied, result, 'an already stamped project is not migrated twice');
  }
});

test('legacy four-wire migration preserves custom colors and already swapped choices', () => {
  for (const [conductor, cable, expectedConductor, expectedCable] of [
    [{ green: '#12aBcD', white: '#654321' }, { green: '#aa00ff', white: '#ffff00' }, { white: '#12aBcD', green: '#654321' }, { white: '#aa00ff', green: '#ffff00' }],
    [{ green: '#ffffff', white: '#2b9b68' }, { green: '#ffffff', white: '#2B9B68' }, { white: '#ffffff', green: '#2b9b68' }, { white: '#ffffff', green: '#2B9B68' }],
    [{ green: '#2B9B68', white: '#FFFFFF' }, { green: '#2B9B68', white: '#FFFFFF' }, { white: '#ffffff', green: '#2b9b68' }, { white: '#ffffff', green: '#2b9b68' }],
  ]) {
    const input = legacyFourWireProject();
    Object.assign(input.nodes[0].colors, conductor);
    for (const role of ['green', 'white']) input.wires.find(w => w.id === `four-${role}`).color = cable[role];
    const result = normalize(input);
    for (const role of ['white', 'green']) {
      assert.equal(result.nodes[0].colors[role], expectedConductor[role]);
      assert.equal(result.wires.find(w => w.from === `device-1:${role}`).color, expectedCable[role]);
    }
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result);
  }
});

test('legacy reversed four-wire connections migrate with their original route geometry', () => {
  const input = legacyFourWireProject('left', '4');
  const expected = normalize(structuredClone(input));
  for (const wire of input.wires.filter(w => ['four-green', 'four-white'].includes(w.id))) {
    [wire.from, wire.to] = [wire.to, wire.from];
    for (const key of ['manual', 'savedRoute']) {
      const route = wire[key];
      wire[key] = { points: route.points.slice().reverse(), from: route.to, to: route.from };
    }
  }
  const before = structuredClone(input);
  assert.deepEqual(normalize(input), expected, 'reversed imports retain the same recolored connections and bends');
  assert.deepEqual(input, before);
});

test('manual segment geometry and endpoint anchors survive save and reopen', () => {
  const manual = manualRoute();
  const result = normalize(project({ wires: [wire({ manual })] }));
  assert.deepEqual(result.wires[0].manual, manual);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result);
  assert.notEqual(result.wires[0].manual.points, manual.points, 'normalization owns a fresh geometry array');
});

test('reversed input wires also reverse their manual route and endpoint anchors', () => {
  const canonical = manualRoute();
  const manual = { points: canonical.points.slice().reverse(), from: canonical.to, to: canonical.from };
  const result = normalize(project({ wires: [wire({ from: 'module-1:ch0-minus', to: 'device-1:black', manual })] }));
  assert.equal(result.wires[0].from, 'device-1:black');
  assert.equal(result.wires[0].to, 'module-1:ch0-minus');
  assert.deepEqual(result.wires[0].manual, canonical);
  assert.deepEqual(manual.points, canonical.points.slice().reverse(), 'normalization must not mutate imported route arrays');
});

test('malformed or misdirected manual geometry falls back to automatic routing', () => {
  const valid = manualRoute();
  for (const manual of [
    null, {}, { ...valid, points: [] },
    { ...valid, points: [{ x: 250, y: 120 }, { x: 320, y: 340 }, { x: 560, y: 340 }] },
    { ...valid, from: { ...valid.from, x: NaN } },
    { ...valid, to: { ...valid.to, x: 100001 } },
    { ...valid, from: { ...valid.from, side: 'left' } },
    { ...valid, points: Array.from({ length: 129 }, () => ({ x: 250, y: 120 })) },
  ]) {
    const result = normalize(project({ wires: [wire({ manual })] }));
    assert.equal(result.wires.length, 1);
    assert.equal(result.wires[0].manual, undefined);
    assert.equal(result.wires[0].from, 'device-1:black');
    assert.equal(result.wires[0].to, 'module-1:ch0-minus');
  }
});

test('saved wire routes survive save and reopen independently of manual geometry', () => {
  const manual = manualRoute();
  const savedRoute = { ...manualRoute(), points: manualRoute().points.map((p, i) => ({ ...p, x: i === 1 || i === 2 ? 350 : p.x })) };
  const result = normalize(project({ wires: [wire({ manual, savedRoute })] }));
  assert.deepEqual(result.wires[0].savedRoute, savedRoute);
  assert.deepEqual(result.wires[0].manual, manual);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result);
  assert.notEqual(result.wires[0].savedRoute.points, savedRoute.points);
  assert.notEqual(result.wires[0].savedRoute.points, result.wires[0].manual.points);
});

test('saved route geometry reverses with imported module-to-device connections', () => {
  const canonical = manualRoute();
  const savedRoute = { points: canonical.points.slice().reverse(), from: canonical.to, to: canonical.from };
  const input = project({ wires: [wire({ from: 'module-1:ch0-minus', to: 'device-1:black', savedRoute })] });
  const result = normalize(input);
  assert.equal(result.wires[0].from, 'device-1:black');
  assert.equal(result.wires[0].to, 'module-1:ch0-minus');
  assert.deepEqual(result.wires[0].savedRoute, canonical);
  assert.deepEqual(savedRoute.points, canonical.points.slice().reverse(), 'imported route geometry is not mutated');
});

test('invalid saved geometry is discarded while retaining valid manual geometry and connections', () => {
  const manual = manualRoute();
  for (const savedRoute of [
    null, {}, { ...manual, points: [] },
    { ...manual, points: [{ x: 250, y: 120 }, { x: 320, y: 340 }, { x: 560, y: 340 }] },
    { ...manual, from: { ...manual.from, x: NaN } },
    { ...manual, to: { ...manual.to, x: 100001 } },
    { ...manual, from: { ...manual.from, side: 'left' } },
    { ...manual, points: Array.from({ length: 129 }, () => ({ x: 250, y: 120 })) },
  ]) {
    const result = normalize(project({ wires: [wire({ manual, savedRoute })] }));
    assert.equal(result.wires.length, 1);
    assert.equal(result.wires[0].savedRoute, undefined);
    assert.deepEqual(result.wires[0].manual, manual);
    assert.equal(result.wires[0].from, 'device-1:black');
    assert.equal(result.wires[0].to, 'module-1:ch0-minus');
  }
});

test('automatic routing is opt-in and remains explicit after save and reopen', () => {
  for (const settings of [undefined, {}, { autoRoute: false }, { autoRoute: 1 }, { autoRoute: 'true' }, { autoRoute: null }]) {
    assert.equal(normalize(project({ settings })).settings.autoRoute, false);
  }
  const optedIn = normalize(project({ settings: { grid: 10, snap: true, defaultWidth: 2.5, autoRoute: true } }));
  assert.equal(optedIn.settings.autoRoute, true);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(optedIn))), optedIn);
});

test('multiple connections from a single conductor are rejected', () => {
  assert.throws(() => normalize(project({ wires: [wire(), wire({ id: 'wire-2', to: 'module-1:ch2-minus' })] })), /conductor.*more than once/i);
});

test('multiple conductors cannot occupy a single non-common module terminal', () => {
  const source = project({ nodes: [device(), device({ id: 'device-2' }), module()], wires: [wire(), wire({ id: 'wire-2', from: 'device-2:black' })] });
  assert.throws(() => normalize(source), /terminal.*more than once/i);
});

test('missing, same-kind, and malformed connections reject the imported project', () => {
  for (const patch of [
    { from: 'missing:black' }, { to: 'module-1:missing' },
    { to: 'device-1:white' }, { from: 'module-1:ch2-minus' },
    { from: null }, { to: {} },
  ]) assert.throws(() => normalize(project({ wires: [wire(patch)] })));
  assert.throws(() => normalize(project({ wires: [null] })));
});

test('prototype properties are never treated as actual connection ports', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => normalize(project({ wires: [wire({ from: key })] })), `from ${key} must be rejected`);
    assert.throws(() => normalize(project({ wires: [wire({ to: key })] })), `to ${key} must be rejected`);
  }
});

test('unknown module types including inherited object properties are rejected', () => {
  for (const type of ['BOGUS', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => normalize(project({ nodes: [device(), module({ type })] })));
  }
});

test('invalid and duplicate node/wire IDs reject imports', () => {
  for (const id of ['', 'with space', 'with:colon', '<svg>', '../path']) {
    assert.throws(() => normalize(project({ nodes: [device({ id }), module()] })));
    assert.throws(() => normalize(project({ wires: [wire({ id })] })));
  }
  assert.throws(() => normalize(project({ nodes: [device(), device(), module()] })), /duplicate|invalid/i);
  assert.throws(() => normalize(project({ wires: [wire(), wire({ from: 'device-1:white', to: 'module-1:ch0-plus' })] })), /duplicate|invalid/i);
});

test('color and numeric settings sanitize safely without retaining CSS values', () => {
  const source = project({
    nodes: [device({ wireCount: '4', colors: { red: '#ABCDEF', black: 'url(javascript:bad)', green: 'red', white: '#fff' }, cableSide: 'invalid', wireSide: 'invalid' }), module()],
    wires: [wire({ color: 'url(#fake)', width: 500 })],
    settings: { grid: 13, snap: false, defaultWidth: -5 },
  });
  const result = normalize(source);
  assert.equal(result.nodes[0].wireCount, 4);
  assert.deepEqual(result.nodes[0].colors, { red: '#ABCDEF', black: CONDUCTORS[4][1].color, green: CONDUCTORS[4].find(c => c.key === 'green').color, white: '#ffffff' });
  assert.equal(result.nodes[0].cableSide, 'left');
  assert.equal(result.nodes[0].wireSide, 'right');
  assert.equal(result.wires[0].color, CONDUCTORS[4][1].color);
  assert.equal(result.wires[0].width, 8);
  assert.deepEqual(result.settings, { grid: 10, snap: false, defaultWidth: 1, autoRoute: false });
  assert.equal(safeColor('#a1B2c3'), '#a1B2c3');
  assert.equal(safeColor('transparent', '#123456'), '#123456');
});

test('imported positions and text lengths are bounded, and non-finite coordinates become zero', () => {
  const result = normalize(project({ nodes: [device({ x: -1e20, y: 1e20, name: 'X'.repeat(300), cable: '9'.repeat(100) }), module({ x: Infinity, y: 'not-a-number' })] }));
  assert.equal(result.nodes[0].x, -10000);
  assert.equal(result.nodes[0].y, 20000);
  assert.equal(result.nodes[0].name.length, 120);
  assert.equal(result.nodes[0].cable.length, 36);
  assert.equal(result.nodes[1].x, 0);
  assert.equal(result.nodes[1].y, 0);
});

test('editor and import share the same position limits', () => {
  assert.deepEqual([POSITION_MIN, POSITION_MAX], [-10000, 20000]);
  assert.equal(positionInBounds(POSITION_MIN, POSITION_MAX), true);
  assert.equal(positionInBounds(POSITION_MIN - 1, 0), false);
  assert.equal(positionInBounds(0, POSITION_MAX + 1), false);
  assert.equal(positionInBounds('0', 0), false);
  assert.equal(clampPosition(POSITION_MIN - 10), POSITION_MIN);
  assert.equal(clampPosition(POSITION_MAX + 10), POSITION_MAX);
  const edited = project({ nodes: [device({ x: clampPosition(POSITION_MAX + 10), y: clampPosition(POSITION_MIN - 10) }), module()], wires: [] });
  const reopened = normalize(edited);
  assert.deepEqual([reopened.nodes[0].x, reopened.nodes[0].y], [edited.nodes[0].x, edited.nodes[0].y]);
});

test('editor capacity guard uses the project limits enforced by import', () => {
  const nearLimit = { nodes: Array(MAX_PROJECT_NODES - 1), wires: Array(MAX_PROJECT_WIRES - 1) };
  assert.equal(canAddToProject(nearLimit, { nodes: 1, wires: 1 }), true);
  assert.equal(canAddToProject(nearLimit, { nodes: 2 }), false);
  assert.equal(canAddToProject(nearLimit, { wires: 2 }), false);
  assert.equal(canAddToProject(nearLimit, { nodes: -1 }), false);
  assert.equal(canAddToProject(nearLimit, { wires: 0.5 }), false);
});

test('unsupported formats, versions, item kinds, and oversized projects are rejected', () => {
  for (const input of [null, {}, [], { version: 1, nodes: [], wires: null }, project({ version: 2 }), project({ nodes: [{ id: 'x', kind: 'unsupported' }] })]) assert.throws(() => normalize(input));
  assert.throws(() => normalize(project({ nodes: Array.from({ length: 501 }, (_, i) => device({ id: `d-${i}` })) })), /too large/i);
  assert.throws(() => normalize(project({ wires: Array.from({ length: 2001 }, (_, i) => wire({ id: `w-${i}` })) })), /too large/i);
});

test('export bounds include titles, labels, and every routed bend', () => {
  const nodes = [device({ x: -40, y: 80 }), module({ x: 500, y: 0 })];
  const route = { points: [{ x: -120, y: 100 }, { x: -120, y: 800 }, { x: 500, y: 800 }] };
  const b = boundsOf(nodes, MODULE_TYPES, { wire: route });
  assert.ok(b.x <= -120);
  assert.ok(b.y <= -42);
  assert.ok(b.x + b.width >= 500 + MODULE_TYPES.AI.width);
  assert.ok(b.y + b.height >= 800);
  assert.deepEqual(boundsOf([], MODULE_TYPES), { x: 0, y: 0, width: 900, height: 600 });
});

test('names and cable text are escaped before inclusion in SVG', () => {
  assert.equal(escapeXML('<script a="x">&\'</script>'), '&lt;script a=&quot;x&quot;&gt;&amp;&apos;&lt;/script&gt;');
  assert.equal(escapeXML(null), '');
});

test('source channel assignments survive save/open, including unwired devices', () => {
  const assignment = { moduleId: 'module-1', channel: 0, tag: 'rioa.slot5.ai0', statusTag: '', pinType: 'AI' };
  const result = normalize(project({ sourceSchedule: 'rio-schedule-v1', nodes: [device({ assignment }), module({ scheduleId: 'rioa-slot5' })], wires: [] }));
  assert.deepEqual(result.nodes[0].assignment, assignment);
  assert.equal(result.nodes[1].scheduleId, 'rioa-slot5');
  assert.equal(result.sourceSchedule, 'rio-schedule-v1');
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result);
});

test('invalid and orphaned source assignments do not survive an import', () => {
  for (const assignment of [{ moduleId: 'missing', channel: 0 }, { moduleId: 'module-1', channel: -1 }, { moduleId: 'module-1', channel: 1.5 }, { moduleId: '../invalid', channel: 0 }]) {
    const result = normalize(project({ nodes: [device({ assignment }), module()], wires: [] }));
    assert.equal(result.nodes[0].assignment, undefined);
  }
});
