import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, RTD_CHANNEL_LAYOUT_REVISION, applyRtdChannelLayout, geometry, normalizeProject } from '../dist/model.js';

function oldRtdProject() {
  const modules = [
    { id: 'rtd', kind: 'module', type: 'AI_RTD', name: 'RTD', x: 500, y: 100 },
    { id: 'ai', kind: 'module', type: 'AI', name: 'AI', x: 1300, y: 100 },
  ];
  const devices = Array.from({ length: 5 }, (_, channel) => ({
    id: `device-${channel}`, kind: 'device', name: `Device ${channel}`, x: channel < 2 ? 100 : 1000,
    y: 100 + channel * 120, wireCount: 4, wireSide: channel < 2 ? 'right' : 'left',
  }));
  const { ports } = geometry([...modules, ...devices], MODULE_TYPES);
  const wires = Array.from({ length: 5 }, (_, channel) => {
    const from = ports[`device-${channel}:red`];
    const toId = channel < 4 ? `rtd:ch${channel}-mplus` : 'ai:ch0-minus';
    const current = ports[toId];
    const oldTo = channel === 1 ? { x: 560, y: 430, side: 'left' }
      : channel === 2 ? { x: 800, y: 410, side: 'right' }
        : { x: current.x, y: current.y, side: current.side };
    const middleX = channel === 4 ? 900 : (from.x + oldTo.x) / 2;
    const route = {
      from: { x: from.x, y: from.y, side: from.side }, to: oldTo,
      points: [{ x: from.x, y: from.y }, { x: middleX, y: from.y }, { x: middleX, y: oldTo.y }, { x: oldTo.x, y: oldTo.y }],
    };
    return { id: `wire-${channel}`, from: from.id, to: toId, color: '#e54b4b', width: 2.5, manual: route, savedRoute: structuredClone(route) };
  });
  return { version: 1, title: 'Old RTD layout', fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
    nodes: [...modules, ...devices], wires, settings: { grid: 10, snap: true, defaultWidth: 2.5 } };
}

test('old RTD projects rebuild only moved-channel routes and keep logical endpoints', () => {
  const input = oldRtdProject(), original = structuredClone(input);
  const opened = normalizeProject(input, MODULE_TYPES);
  assert.deepEqual(input, original, 'opening does not mutate the saved file');
  assert.equal(opened.rtdChannelLayoutRevision, RTD_CHANNEL_LAYOUT_REVISION);
  assert.deepEqual(opened.wires.map(w => w.to), original.wires.map(w => w.to));
  for (const channel of [1, 2]) {
    const wire = opened.wires.find(w => w.id === `wire-${channel}`);
    assert.equal(wire.manual, undefined);
    assert.equal(wire.savedRoute, undefined);
  }
  for (const channel of [0, 3, 4]) {
    const wire = opened.wires.find(w => w.id === `wire-${channel}`);
    assert.deepEqual(wire.manual, original.wires[channel].manual);
    assert.deepEqual(wire.savedRoute, original.wires[channel].savedRoute);
  }
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(opened)), MODULE_TYPES), opened, 'save/reopen does not migrate twice');
  assert.equal(applyRtdChannelLayout(opened, MODULE_TYPES), false);
});

test('current RTD revision preserves deliberate paths on CH1 and CH2', () => {
  const input = oldRtdProject();
  input.rtdChannelLayoutRevision = RTD_CHANNEL_LAYOUT_REVISION;
  const opened = normalizeProject(input, MODULE_TYPES);
  for (const channel of [1, 2]) {
    assert.deepEqual(opened.wires[channel].manual, input.wires[channel].manual);
    assert.deepEqual(opened.wires[channel].savedRoute, input.wires[channel].savedRoute);
  }
});
