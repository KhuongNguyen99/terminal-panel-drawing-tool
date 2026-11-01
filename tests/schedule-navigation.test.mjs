import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleModuleIdForNode, focusNodesForModule } from '../dist/schedule-navigation.js';

const fixture = () => ({
  nodes: [
    { id: 'assigned', kind: 'device', assignment: { moduleId: 'module-a', channel: 0 }, width: 380, height: 150 },
    { id: 'module-a', kind: 'module', rio: 'RIO A', slot: '5' },
    { id: 'wired', kind: 'device', width: 420, height: 175 },
    { id: 'both', kind: 'device', assignment: { moduleId: 'module-a', channel: 1 } },
    { id: 'module-b', kind: 'module', rio: 'RIO B', slot: '3' },
    { id: 'other', kind: 'device', assignment: { moduleId: 'module-b', channel: 0 } },
    { id: 'unassigned', kind: 'device' },
  ],
  wires: [
    { from: 'wired:black', to: 'module-a:ch2-minus' },
    { from: 'wired:white', to: 'module-a:ch2-plus' },
    { from: 'module-a:ch1-minus', to: 'both:black' },
    { from: 'both:white', to: 'module-a:ch1-plus' },
    { from: 'other:black', to: 'module-b:ch0-minus' },
  ],
});

test('slot focus includes unwired assignments and legacy wired labels exactly once', () => {
  const project = fixture();
  assert.deepEqual(focusNodesForModule('module-a', project).map(n => n.id), ['module-a', 'assigned', 'wired', 'both']);
  assert.deepEqual(focusNodesForModule('module-b', project).map(n => n.id), ['module-b', 'other']);
  assert.deepEqual(focusNodesForModule('missing', project), []);
});

test('module lookup respects assignments and recognizes reversed legacy connections', () => {
  const project = fixture();
  const byId = id => project.nodes.find(n => n.id === id);
  assert.equal(scheduleModuleIdForNode(byId('module-a'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('assigned'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('wired'), project), 'module-a');
  delete byId('both').assignment;
  assert.equal(scheduleModuleIdForNode(byId('both'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('unassigned'), project), null);
  assert.equal(scheduleModuleIdForNode(null, project), null);
});

test('explicit assignment wins while ambiguous or stale connections do not invent a module', () => {
  const project = fixture();
  const assigned = project.nodes.find(n => n.id === 'assigned');
  project.wires.push({ from: 'assigned:black', to: 'module-b:ch1-minus' });
  assert.equal(scheduleModuleIdForNode(assigned, project), 'module-a');
  assert.ok(focusNodesForModule('module-b', project).includes(assigned), 'focus includes direct wiring even when assignment differs');
  const wired = project.nodes.find(n => n.id === 'wired');
  project.wires.push({ from: 'wired:red', to: 'module-b:ch1-plus' });
  assert.equal(scheduleModuleIdForNode(wired, project), null);
  assigned.assignment.moduleId = 'removed-module';
  assert.equal(scheduleModuleIdForNode(assigned, project), 'module-b', 'a stale assignment falls back to a unique existing connection');
  project.wires.push({ from: 'unassigned:black', to: 'removed-module:ch0-minus' });
  assert.equal(scheduleModuleIdForNode(project.nodes.find(n => n.id === 'unassigned'), project), null);
});

test('focusing preserves imported dimensions and object identity without mutating the project', () => {
  const project = fixture(), before = structuredClone(project);
  for (const node of project.nodes) { if (node.assignment) Object.freeze(node.assignment); Object.freeze(node); }
  for (const wire of project.wires) Object.freeze(wire);
  Object.freeze(project.nodes); Object.freeze(project.wires); Object.freeze(project);
  const focused = focusNodesForModule('module-a', project);
  for (const node of focused) assert.equal(node, project.nodes.find(original => original.id === node.id));
  assert.deepEqual(focused.filter(n => n.kind === 'device').map(n => [n.width, n.height]), [[380, 150], [420, 175], [undefined, undefined]]);
  for (const node of project.nodes) scheduleModuleIdForNode(node, project);
  assert.deepEqual(project, before);
});

test('focused exports include directly connected DIN and I/O modules without expanding the whole network', () => {
  const project = fixture();
  project.nodes.push({ id: 'din', kind: 'module', type: 'DIN_RESISTOR' });
  project.wires.push({ from: 'module-a:ch0-minus', to: 'din:top-1' });
  project.wires.push({ from: 'din:bottom-1', to: 'module-b:ch0-plus' });
  assert.deepEqual(focusNodesForModule('module-a', project).map(n => n.id), ['module-a', 'assigned', 'wired', 'both', 'din']);
  assert.deepEqual(focusNodesForModule('din', project).map(n => n.id), ['din', 'module-a', 'module-b']);
});

const taggedFixture = () => {
  const project = fixture();
  project.nodes.unshift({ id: 'assigned-tag', kind: 'tag', name: 'PRESSURE', wireSide: 'right' });
  project.nodes.push(
    { id: 'module-tag', kind: 'tag', name: 'Pressure', wireSide: 'bottom' },
    { id: 'wired-tag', kind: 'tag', name: 'Flow', wireSide: 'left' },
    { id: 'remote-tag', kind: 'tag', name: ' pressure ', wireSide: 'top' },
    { id: 'unwired-tag', kind: 'tag', name: 'PRESSURE', wireSide: 'right' },
    { id: 'unassigned-tag', kind: 'tag', name: 'pressure', wireSide: 'left' },
  );
  project.wires.push(
    { from: 'assigned:black', to: 'assigned-tag:connector' },
    { from: 'module-tag:connector', to: 'module-a:ch3-plus' },
    { from: 'wired-tag:connector', to: 'wired:red' },
    { from: 'module-b:ch2-plus', to: 'remote-tag:connector' },
    { from: 'unassigned:white', to: 'unassigned-tag:connector' },
  );
  return project;
};

test('slot focus retains tags on assigned and physically wired devices in project order', () => {
  const project = taggedFixture();
  const focused = focusNodesForModule('module-a', project);
  assert.deepEqual(focused.map(n => n.id), ['module-a', 'assigned-tag', 'assigned', 'wired', 'both', 'module-tag', 'wired-tag']);
  const ids = new Set(focused.map(n => n.id));
  const exportedWires = project.wires.filter(w => ids.has(w.from.split(':')[0]) && ids.has(w.to.split(':')[0]));
  assert.ok(exportedWires.some(w => w.to === 'assigned-tag:connector'), 'an unwired but assigned device keeps its short tag wire');
  assert.ok(exportedWires.some(w => w.from === 'wired-tag:connector'), 'a physical device connection keeps its tag wire in either direction');
  assert.ok(exportedWires.some(w => w.from === 'module-tag:connector'), 'a tag directly on the selected module stays in the export');
});

test('matching remote tag names do not expand local module focus or scoped exports', () => {
  const project = taggedFixture();
  const focused = focusNodesForModule('module-a', project);
  for (const id of ['module-b', 'other', 'remote-tag', 'unwired-tag', 'unassigned', 'unassigned-tag']) {
    assert.equal(focused.some(n => n.id === id), false, `${id} stays outside the local module scope`);
  }
  assert.deepEqual(focusNodesForModule('module-b', project).map(n => n.id), ['module-b', 'other', 'remote-tag']);
  const before = focused.map(n => n.id);
  for (const node of project.nodes) if (node.kind === 'tag') node.name = 'SAME NAME';
  assert.deepEqual(focusNodesForModule('module-a', project).map(n => n.id), before, 'group names never determine export membership');
});

test('tag navigation resolves only a directly wired module or its local device assignment', () => {
  const project = taggedFixture(), byId = id => project.nodes.find(n => n.id === id);
  assert.equal(scheduleModuleIdForNode(byId('module-tag'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('assigned-tag'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('wired-tag'), project), 'module-a');
  assert.equal(scheduleModuleIdForNode(byId('remote-tag'), project), 'module-b');
  assert.equal(scheduleModuleIdForNode(byId('unwired-tag'), project), null);
  assert.equal(scheduleModuleIdForNode(byId('unassigned-tag'), project), null);
  assert.equal(scheduleModuleIdForNode(byId('unassigned'), project), null, 'tags do not change existing device navigation');
  byId('assigned').assignment.moduleId = 'removed-module';
  project.wires.push({ from: 'assigned:white', to: 'module-b:ch3-plus' });
  assert.equal(scheduleModuleIdForNode(byId('assigned-tag'), project), 'module-b', 'a tag follows its device’s valid physical fallback');
  project.wires.push({ from: 'wired:green', to: 'module-b:ch3-minus' });
  assert.equal(scheduleModuleIdForNode(byId('wired-tag'), project), null, 'ambiguous local device wiring does not invent a slot');
});

test('tags and tagged focus remain read-only and do not traverse tag-to-tag chains', () => {
  const project = taggedFixture();
  project.wires.push({ from: 'module-tag:connector', to: 'unwired-tag:connector' });
  const before = structuredClone(project);
  for (const node of project.nodes) { if (node.assignment) Object.freeze(node.assignment); Object.freeze(node); }
  for (const wire of project.wires) Object.freeze(wire);
  Object.freeze(project.nodes); Object.freeze(project.wires); Object.freeze(project);
  assert.equal(scheduleModuleIdForNode(project.nodes.find(n => n.id === 'unwired-tag'), project), null);
  const focused = focusNodesForModule('module-a', project);
  assert.equal(focused.some(n => n.id === 'unwired-tag'), false);
  for (const node of focused) assert.equal(node, project.nodes.find(n => n.id === node.id));
  for (const node of project.nodes) scheduleModuleIdForNode(node, project);
  assert.deepEqual(project, before);
});
