import test from 'node:test';
import assert from 'node:assert/strict';
import { RIO_SCHEDULE, SCHEDULE_SUMMARY, createScheduleProject } from '../dist/schedule.js';
import { MODULE_TYPES } from '../dist/modules.js';
import { boundsOf, deviceHeight, deviceWidth, geometry, normalizeProject } from '../dist/model.js';
import { routeWires } from '../dist/router.js';

const project = createScheduleProject();
const slot = id => RIO_SCHEDULE.find(s => s.id === id);

test('schedule represents every unique physical channel without status or blank duplicates', () => {
  assert.deepEqual(RIO_SCHEDULE.filter(s => s.rio === 'RIO A').map(s => s.slot), ['1', '2', '3', '5', '6', '7', '8', '11', '12', '13', '14', '15']);
  assert.deepEqual(RIO_SCHEDULE.filter(s => s.rio === 'RIO B').map(s => s.slot), ['1', '2', '3', '4', '5', '8', '9', '10', '11', '12']);
  assert.deepEqual({ ...SCHEDULE_SUMMARY, byRio: undefined }, {
    slots: 22, channels: 100, assigned: 56, spare: 44, numberedCables: 26,
    missingCableNumbers: 30, wires: 82, pendingConductors: 44, pendingDevices: 23, byRio: undefined,
  });
  assert.deepEqual(SCHEDULE_SUMMARY.byRio.map(s => [s.rio, s.slots, s.channels, s.assigned, s.numberedCables]), [
    ['RIO A', 12, 58, 34, 16], ['RIO B', 10, 42, 22, 10],
  ]);
  const channels = RIO_SCHEDULE.flatMap(s => s.channels.map(c => `${s.id}:${c.channel}`));
  assert.equal(new Set(channels).size, 100);
  assert.equal(RIO_SCHEDULE.flatMap(s => s.channels).filter(c => c.statusTag).length, 24);
  assert.ok(project.nodes.every(n => !n.name.endsWith('.wire_ok')));
  assert.equal(project.nodes.filter(n => n.kind === 'module').length, 22);
  assert.equal(project.nodes.filter(n => n.kind === 'device').length, 56);
});

test('handwritten cable assignments preserve the supplied device and channel associations', () => {
  const numbered = RIO_SCHEDULE.flatMap(s => s.channels.filter(c => c.cable).map(c => [s.id, c.channel, c.device, c.cable]));
  assert.deepEqual(numbered, [
    ['rioa-slot5', 0, '*v-3501#-y-pos', '17'], ['rioa-slot5', 1, '*v-3511#-y-pos', '23'],
    ['rioa-slot5', 2, '*v-3531#-pos', '13'], ['rioa-slot5', 3, '*v-3541#-pos', '21'],
    ['rioa-slot5', 4, '*v-3541#-y-pos', '19'], ['rioa-slot5', 5, '*v-3551#-pos', '9'],
    ['rioa-slot5', 6, '*v-3561#-pos', '7'], ['rioa-slot5', 7, '*v-3571#1-pos', '26'],
    ['rioa-slot7', 0, '*th-3511#', '20'], ['rioa-slot7', 1, '*th-3530#', '14'],
    ['rioa-slot7', 2, '*th-3550#', '10'], ['rioa-slot7', 3, '*th-3560#', '8'],
    ['rioa-slot11', 0, '*pd-3500#1', '2'], ['rioa-slot11', 1, '*dp-3500#1', '1'],
    ['rioa-slot12', 0, '*pd-3500#3', '6'], ['rioa-slot12', 1, '*dp-3500#3', '5'],
    ['riob-slot3', 0, '*v-3501#-pos', '15'], ['riob-slot3', 1, '*v-3511#-pos', '22'],
    ['riob-slot3', 2, '*v-3521#-pos', '11'], ['riob-slot3', 3, '*v-3571#-y-pos', '28'],
    ['riob-slot3', 4, '*v-3571#2-pos', '27'], ['riob-slot4', 0, '*th-3520#', '12'],
    ['riob-slot4', 1, '*th-3531#', '16'], ['riob-slot4', 2, '*th-3541#', '18'],
    ['riob-slot8', 0, '*pd-3500#2', '4'], ['riob-slot8', 1, '*dp-3500#2', '3'],
  ]);
  assert.equal(project.nodes.filter(n => n.kind === 'device' && !n.cable).length, 30);
  assert.ok(!numbered.some(([, , , cable]) => ['24', '25'].includes(cable)));
});

test('unnumbered valve output and feedback names retain their exact suffixes', () => {
  const expected = {
    'rioa-slot1': ['*v-3501#-y', '*v-3511#-y', '*v-3531#', '*v-3541#-close', '*v-3541#-open', '*v-3541#-y', '*v-3551#-close', '*v-3551#-open'],
    'rioa-slot2': ['*v-3501#-y_fb', '*v-3511#-y_fb', '*v-3531#_fb', '*v-3541#-close_fb', '*v-3541#-open_fb', '*v-3541#-y_fb', '*v-3551#-close_fb', '*v-3551#-open_fb'],
    'rioa-slot3': ['*v-3561#', '*v-3571#1'],
    'riob-slot1': ['*v-3501#', '*v-3511#-close', '*v-3511#-open', '*v-3521#', '*v-3571#-y', '*v-3571#2'],
    'riob-slot2': ['*v-3501#_fb', '*v-3511#-close_fb', '*v-3511#-open_fb', '*v-3521#_fb', '*v-3571#-y_fb', '*v-3571#2_fb'],
  };
  for (const [id, names] of Object.entries(expected)) assert.deepEqual(slot(id).channels.filter(c => c.device).map(c => c.device), names);
});

test('Slot 5 stays Slot 5 and uses corrected tags while spare channels remain free', () => {
  const fifth = slot('rioa-slot5');
  assert.equal(fifth.slot, '5');
  assert.equal(fifth.channels.length, 8);
  assert.deepEqual(fifth.channels.map(c => c.tag), Array.from({ length: 8 }, (_, ch) => `rioa.slot5.ai${ch}`));
  for (const s of RIO_SCHEDULE) for (const c of s.channels) {
    if (!c.device) {
      assert.ok(!project.nodes.some(n => n.id === `${s.id}-ch${c.channel}`));
      const terminals = MODULE_TYPES[s.type].ports.filter(p => p.channel === c.channel).map(p => `${s.id}:${p.id}`);
      assert.ok(terminals.length > 0);
      assert.ok(!project.wires.some(w => terminals.includes(w.to)));
    }
    assert.equal(c.pinType, s.type === 'DQ' ? 'DQ' : 'AI');
    assert.equal(c.statusTag, s.type === 'DQ' ? `${c.tag}.wire_ok` : '');
  }
  assert.ok(!RIO_SCHEDULE.some(s => s.type === 'AQ'));
  assert.ok(RIO_SCHEDULE.every(s => s.typeInferred === ['AI_RTD', 'EX_AI'].includes(s.type)));
});

test('stable IDs and assignment metadata identify all populated channels', () => {
  assert.equal(project.sourceSchedule, 'rio-schedule-v1');
  assert.equal(new Set(project.nodes.map(n => n.id)).size, project.nodes.length);
  assert.equal(new Set(project.wires.map(w => w.id)).size, project.wires.length);
  for (const s of RIO_SCHEDULE) {
    const module = project.nodes.find(n => n.id === s.id);
    assert.equal(module.scheduleId, s.id);
    for (const c of s.channels.filter(c => c.device)) {
      const device = project.nodes.find(n => n.id === `${s.id}-ch${c.channel}`);
      assert.deepEqual(device.assignment, { moduleId: s.id, channel: c.channel, tag: c.tag, statusTag: c.statusTag, pinType: c.pinType });
      assert.equal(device.name, c.device);
      assert.equal(device.cable, c.cable);
    }
  }
  assert.deepEqual(createScheduleProject(), project, 'repeated population uses deterministic identities and layout');
  const independentlyCreated = createScheduleProject();
  independentlyCreated.nodes[0].name = 'Changed';
  assert.notEqual(independentlyCreated.nodes[0].name, project.nodes[0].name, 'projects do not share mutable nodes');
});

test('only supported conductor assignments are connected; RTD and shared DQ returns stay pending', () => {
  const { ports } = geometry(project.nodes, MODULE_TYPES);
  assert.equal(project.wires.length, 82);
  assert.equal(project.nodes.filter(n => n.kind === 'device' && n.wireCount === 4).length, 7);
  for (const w of project.wires) {
    const from = ports[w.from], to = ports[w.to];
    const device = project.nodes.find(n => n.id === from.nodeId);
    const module = project.nodes.find(n => n.id === to.nodeId);
    assert.equal(module.id, device.assignment.moduleId);
    assert.equal(to.channel, device.assignment.channel);
    assert.notEqual(module.type, 'AI_RTD');
    assert.notEqual(to.signal, '0V');
    assert.equal(to.signal, from.localId === 'black' ? '-' : '+');
    if (module.type === 'DQ') assert.equal(from.localId, 'white');
  }
  assert.equal(new Set(project.wires.map(w => w.to)).size, 82);
  assert.equal(new Set(project.wires.map(w => w.from)).size, 82);
  assert.equal(normalizeProject(project, MODULE_TYPES).wires.length, 82, 'generated wiring passes normal import validation');
});

test('complete schedule has separated grid-aligned slot groups within export bounds', () => {
  const bounds = boundsOf(project.nodes, MODULE_TYPES);
  for (const [index, s] of RIO_SCHEDULE.entries()) {
    const ox = index % 4 * 1400, oy = Math.floor(index / 4) * 850;
    const module = project.nodes.find(n => n.id === s.id);
    assert.deepEqual([module.x, module.y], [440 + ox, 80 + oy]);
    for (const n of project.nodes.filter(n => n.id === s.id || n.assignment?.moduleId === s.id)) {
      const width = n.kind === 'module' ? MODULE_TYPES[n.type].width : deviceWidth(n);
      const height = n.kind === 'module' ? MODULE_TYPES[n.type].height : deviceHeight(n);
      assert.equal(n.x % 10, 0); assert.equal(n.y % 10, 0);
      assert.ok(n.x >= ox && n.x + width < ox + 1400);
      assert.ok(n.y >= oy && n.y + height < oy + 850);
      assert.ok(n.x >= bounds.x && n.y >= bounds.y);
      assert.ok(n.x + width <= bounds.x + bounds.width && n.y + height <= bounds.y + bounds.height);
      if (n.kind === 'device' && s.type === 'AI_RTD') assert.equal(n.wireSide, n.assignment.channel < 2 ? 'right' : 'left');
    }
  }
  assert.ok(project.nodes.filter(n => n.kind === 'module' && n.rio === 'RIO B').every(n => n.y >= 2630));
});

test('all scheduled connections route between their exact assigned ports with no blocked or shared segments', () => {
  const generated = createScheduleProject();
  const { ports, obstacles } = geometry(generated.nodes, MODULE_TYPES);
  const routing = routeWires({ wires: generated.wires, ports, obstacles, grid: generated.settings.grid });
  assert.equal(routing.diagnostics.blocked, 0);
  assert.equal(routing.diagnostics.sharedSegments, 0);
  assert.equal(routing.diagnostics.routed, 82);
  assert.equal(Object.keys(routing.routes).length, generated.wires.length);
  for (const wire of generated.wires) {
    const route = routing.routes[wire.id], from = ports[wire.from], to = ports[wire.to];
    assert.notEqual(route.status, 'blocked', `${wire.id}: ${route.diagnostics.join(' ')}`);
    assert.deepEqual(route.points[0], { x: from.x, y: from.y }, `${wire.id} begins at its device conductor`);
    assert.deepEqual(route.points.at(-1), { x: to.x, y: to.y }, `${wire.id} ends at its assigned module terminal`);
  }
});

test('saved schedule roundtrip retains every assignment, including all unwired RTD labels', () => {
  const generated = createScheduleProject();
  const first = normalizeProject(generated, MODULE_TYPES);
  const reopened = normalizeProject(JSON.parse(JSON.stringify(first)), MODULE_TYPES);
  assert.deepEqual(reopened, first);
  assert.equal(reopened.sourceSchedule, 'rio-schedule-v1');
  for (const original of generated.nodes) {
    const restored = reopened.nodes.find(n => n.id === original.id);
    if (original.kind === 'module') assert.equal(restored.scheduleId, original.scheduleId);
    else assert.deepEqual(restored.assignment, original.assignment, original.id);
  }
  const rtdModules = new Set(reopened.nodes.filter(n => n.type === 'AI_RTD').map(n => n.id));
  const rtdLabels = reopened.nodes.filter(n => rtdModules.has(n.assignment?.moduleId));
  assert.equal(rtdLabels.length, 7);
  for (const label of rtdLabels) {
    assert.equal(label.wireCount, 4);
    assert.ok(label.assignment.tag);
    assert.ok(!reopened.wires.some(w => w.from.startsWith(`${label.id}:`)));
  }
});
