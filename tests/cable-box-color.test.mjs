import test from 'node:test';
import assert from 'node:assert/strict';
import { CABLE_LABEL_COLORS, assignCableLabelColors, cableBoxColor, cableBoxColorOverride,
  cableLabelColor, setCableBoxColor } from '../dist/cable-colors.js';

const project = () => ({ nodes: [
  { id: 'ma', kind: 'module' }, { id: 'mb', kind: 'module' },
  ...['1', '7', '10', '16', '25', '34'].flatMap((cable, channel) => [
    { id: `a${channel}`, kind: 'device', cable, assignment: { moduleId: 'ma', channel } },
    { id: `b${channel}`, kind: 'device', cable: ` ${cable} `, assignment: { moduleId: 'mb', channel } },
  ]),
  { id: 'blank-a', kind: 'device', cable: '' }, { id: 'blank-b', kind: 'device', cable: ' ' },
  { id: 'tag', kind: 'tag', cable: '1' },
], wires: [{ id: 'wire', from: 'a0:black', to: 'ma:ch0-minus', color: '#123456' }] });

test('manual box colors synchronize matching numbers across modules and reset as a group', () => {
  const p = project(), baseline = assignCableLabelColors(p), before = structuredClone(p);
  assert.equal(setCableBoxColor(p, ['a0'], CABLE_LABEL_COLORS[4]), true);
  assert.equal(p.nodes.find(n => n.id === 'a0').boxColor, CABLE_LABEL_COLORS[4]);
  assert.equal(p.nodes.find(n => n.id === 'b0').boxColor, CABLE_LABEL_COLORS[4]);
  for (const n of p.nodes.filter(n => !['a0', 'b0'].includes(n.id))) assert.equal(Object.hasOwn(n, 'boxColor'), false);
  assert.deepEqual(p.wires, before.wires);
  const manual = assignCableLabelColors(p);
  assert.equal(cableLabelColor('1', manual), CABLE_LABEL_COLORS[4]);
  assert.equal(new Set(['1', '7', '10', '16', '25', '34'].map(c => manual.get(c))).size, 6, 'automatic colors avoid the pinned color');
  setCableBoxColor(p, ['b0'], '');
  assert.deepEqual(p, before);
  assert.deepEqual(assignCableLabelColors(p), baseline);
});

test('batch edits respect selected cable groups and blank labels remain independent', () => {
  const p = project();
  setCableBoxColor(p, ['a0', 'a1', 'blank-a', 'ma', 'tag'], CABLE_LABEL_COLORS[0]);
  for (const id of ['a0', 'a1', 'b0', 'b1', 'blank-a']) assert.equal(cableBoxColor(p.nodes.find(n => n.id === id)), CABLE_LABEL_COLORS[0]);
  for (const id of ['a2', 'b2', 'blank-b', 'ma', 'tag']) assert.equal(cableBoxColor(p.nodes.find(n => n.id === id)), undefined);
  const colors = assignCableLabelColors(p);
  assert.equal(colors.get('1'), CABLE_LABEL_COLORS[0]);
  assert.equal(colors.get('7'), CABLE_LABEL_COLORS[0], 'explicit duplicate colors are honored');
  for (const cable of ['10', '16', '25', '34']) assert.notEqual(colors.get(cable), CABLE_LABEL_COLORS[0]);
  assert.equal(cableBoxColorOverride(p.nodes.find(n => n.id === 'blank-a'), p), CABLE_LABEL_COLORS[0]);
  assert.equal(cableBoxColorOverride(p.nodes.find(n => n.id === 'blank-b'), p), undefined);
});

test('invalid edits are atomic and imported override conflicts resolve consistently', () => {
  const p = project(), before = structuredClone(p);
  for (const color of ['#123456', 'red', 'url(bad)', null, true, {}]) {
    assert.equal(setCableBoxColor(p, ['a0', 'a1'], color), false);
    assert.deepEqual(p, before);
  }
  p.nodes.find(n => n.id === 'a0').boxColor = CABLE_LABEL_COLORS[1];
  p.nodes.find(n => n.id === 'b0').boxColor = CABLE_LABEL_COLORS[3];
  const colors = assignCableLabelColors(p);
  assert.equal(colors.get('1'), CABLE_LABEL_COLORS[1]);
  for (const id of ['a0', 'b0']) assert.equal(cableBoxColorOverride(p.nodes.find(n => n.id === id), p), CABLE_LABEL_COLORS[1]);
  const copy = structuredClone(p);
  assert.deepEqual(assignCableLabelColors({ ...p, nodes: [...p.nodes].reverse() }), colors);
  assert.deepEqual(assignCableLabelColors(JSON.parse(JSON.stringify(p))), colors);
  assert.deepEqual(p, copy, 'resolving conflicts does not mutate imported data');
});
