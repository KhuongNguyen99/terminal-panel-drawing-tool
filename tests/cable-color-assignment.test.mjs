import test from 'node:test';
import assert from 'node:assert/strict';
import { assignCableLabelColors, CABLE_LABEL_COLORS, cableLabelColor } from '../dist/cable-colors.js';
import { focusNodesForModule } from '../dist/schedule-navigation.js';
import { createScheduleProject } from '../dist/schedule.js';

const cableKey = cable => String(cable ?? '').trim().toUpperCase();

function hashCollidingNumbers(count) {
  const baseline = cableLabelColor('1');
  const numbers = [];
  for (let number = 1; numbers.length < count; number++) {
    if (cableLabelColor(String(number)) === baseline) numbers.push(String(number));
  }
  return numbers;
}

function assignedProject(cables, moduleId = 'module-a') {
  return {
    nodes: [
      { id: moduleId, kind: 'module' },
      ...cables.map((cable, index) => ({
        id: `${moduleId}-device-${index}`, kind: 'device', cable,
        assignment: { moduleId, channel: index },
      })),
    ],
    wires: [],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('six hash-colliding cable numbers in one module receive six distinct palette colors', () => {
  const cables = hashCollidingNumbers(6);
  assert.equal(new Set(cables.map(cable => cableLabelColor(cable))).size, 1, 'plain hashing collides for this fixture');
  const project = assignedProject(cables);
  for (const [index, cable] of cables.entries()) {
    project.nodes.push({
      id: `matching-${index}`, kind: 'device', cable: `  ${cable}  `,
      assignment: { moduleId: 'module-a', channel: index + 6 },
    });
  }

  const colors = assignCableLabelColors(project);
  assert.ok(colors instanceof Map);
  assert.equal(colors.size, cables.length);
  assert.equal(new Set(cables.map(cable => colors.get(cable))).size, 6);
  for (const cable of cables) {
    assert.ok(CABLE_LABEL_COLORS.includes(colors.get(cable)));
    assert.equal(cableLabelColor(cable, colors), cableLabelColor(`  ${cable}  `, colors));
    assert.equal(cableLabelColor(Number(cable), colors), colors.get(cable));
  }
});

test('more than six simultaneous cables keep all labels in the six-color palette', () => {
  const cables = hashCollidingNumbers(8);
  const colors = assignCableLabelColors(assignedProject(cables));
  assert.deepEqual([...colors.keys()].sort(), [...cables].sort());
  assert.equal(new Set(colors.values()).size, CABLE_LABEL_COLORS.length);
  for (const cable of cables) {
    assert.ok(CABLE_LABEL_COLORS.includes(cableLabelColor(cable, colors)), cable);
  }
});

test('unwired assignments and devices connected through inline labels both constrain a module', () => {
  const cables = hashCollidingNumbers(6);
  const project = assignedProject(cables.slice(0, 5));
  project.nodes.push(
    { id: 'inline', kind: 'wire-label', name: 'lead' },
    { id: 'physical', kind: 'device', cable: cables[5] },
  );
  project.wires.push(
    { from: 'module-a:ch5-minus', to: 'inline:left' },
    { from: 'inline:right', to: 'physical:black' },
  );
  const focused = focusNodesForModule('module-a', project);
  assert.equal(focused.filter(node => node.kind === 'device').length, 6);
  assert.ok(focused.some(node => node.id === 'physical'));

  const colors = assignCableLabelColors(project);
  assert.equal(new Set(cables.map(cable => colors.get(cable))).size, 6);
});

test('shared cables retain one global color across modules, order changes, and save/reopen', () => {
  const cables = hashCollidingNumbers(11);
  const project = assignedProject(cables.slice(0, 6));
  const second = assignedProject([cables[0], ...cables.slice(6)], 'module-b');
  second.nodes[1].cable = `  ${cables[0]}  `;
  project.nodes.push(...second.nodes);
  project.nodes.push({ id: 'orphan', kind: 'device', cable: 'unassigned-cable' });

  const before = structuredClone(project);
  const colors = assignCableLabelColors(deepFreeze(project));
  assert.deepEqual(project, before, 'color assignment is read-only even for a frozen project');
  for (const moduleId of ['module-a', 'module-b']) {
    const focused = focusNodesForModule(moduleId, project);
    const localColors = focused.filter(node => node.kind === 'device')
      .map(node => cableLabelColor(node.cable, colors));
    assert.equal(new Set(localColors).size, 6, moduleId);
  }
  assert.equal(cableLabelColor(cables[0], colors), cableLabelColor(`  ${cables[0]}  `, colors));
  assert.equal(cableLabelColor('unassigned-cable', colors), cableLabelColor('unassigned-cable'));
  for (const blank of ['', '  \t  ', null, undefined]) assert.equal(cableLabelColor(blank, colors), null);

  const reopened = JSON.parse(JSON.stringify(project));
  const reordered = { ...reopened, nodes: [...reopened.nodes].reverse(), wires: [...reopened.wires].reverse() };
  assert.deepEqual(assignCableLabelColors(reopened), colors);
  assert.deepEqual(assignCableLabelColors(reordered), colors);
});

test('the supplied RIO schedule has fewer local cable-color collisions than plain hashing', () => {
  const project = createScheduleProject();
  const colors = assignCableLabelColors(project);
  const localConflicts = colorOf => project.nodes.filter(node => node.kind === 'module').reduce((total, module) => {
    const cables = [...new Set(focusNodesForModule(module.id, project)
      .filter(node => node.kind === 'device').map(node => cableKey(node.cable)).filter(Boolean))];
    for (let left = 0; left < cables.length; left++) {
      for (let right = left + 1; right < cables.length; right++) {
        if (colorOf(cables[left]) === colorOf(cables[right])) total++;
      }
    }
    return total;
  }, 0);
  const baseline = localConflicts(cable => cableLabelColor(cable));
  assert.ok(baseline > 0, 'the schedule exposes collisions under plain hashing');
  assert.ok(localConflicts(cable => cableLabelColor(cable, colors)) < baseline);
});
