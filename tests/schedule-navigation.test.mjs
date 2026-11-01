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
