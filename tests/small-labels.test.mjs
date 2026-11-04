import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_TYPES } from '../dist/modules.js';
import { FOUR_WIRE_ORDER_REVISION, geometry, normalizeProject } from '../dist/model.js';
import { createLabelClipboard, serializeLabelClipboard, parseLabelClipboard } from '../dist/label-clipboard.js';

test('small labels retain their sizes and edge connectors through save and clipboard roundtrips', () => {
  for (const [width, height] of [[1, 1], [5, 10], [40, 20], [100, 35]]) {
    const nodes = [
      ...[2, 4].map(wireCount => ({ id: `device-${wireCount}`, kind: 'device', wireCount })),
      { id: 'inline', kind: 'wire-label' },
      ...['left', 'right', 'top', 'bottom'].map(wireSide => ({ id: `tag-${wireSide}`, kind: 'tag', wireSide })),
    ].map(node => ({ ...node, name: 'Small label', x: 100, y: 200, width, height }));
    const project = normalizeProject({ version: 1, nodes, wires: [], fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION }, MODULE_TYPES);
    assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(project)), MODULE_TYPES), project);
    const clipboard = createLabelClipboard(project.nodes, new Set(nodes.map(n => n.id)));
    assert.deepEqual(parseLabelClipboard(serializeLabelClipboard(clipboard)).nodes.map(n => [n.width, n.height]), nodes.map(() => [width, height]));
    const { ports, obstacles } = geometry(project.nodes, MODULE_TYPES);
    assert.deepEqual(obstacles.map(o => [o.width, o.height]), nodes.map(() => [width, height]));
    for (const port of Object.values(ports)) {
      assert.ok(port.x >= 100 && port.x <= 100 + width);
      assert.ok(port.y >= 200 && port.y <= 200 + height);
      if (port.side === 'left' || port.side === 'right') assert.equal(port.x, 100 + (port.side === 'right' ? width : 0));
      else assert.equal(port.y, 200 + (port.side === 'bottom' ? height : 0));
    }
    for (const wireCount of [2, 4]) {
      const ys = Object.values(ports).filter(p => p.nodeId === `device-${wireCount}`).map(p => p.y);
      assert.ok(ys.slice(1).every((y, i) => y > ys[i]), 'conductors stay in order as the label shrinks');
    }
  }
});
