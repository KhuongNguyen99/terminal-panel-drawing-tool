import test from 'node:test';
import assert from 'node:assert/strict';
import { routePath } from '../dist/wire-path.js';

test('all dense crossings receive distinct bridges without reversing along the cable', () => {
  const path = routePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], [
    { x: 40, y: 0 }, { x: 50, y: 0 }, { x: 60, y: 0 },
  ]);
  assert.equal((path.match(/Q/g) || []).length, 3);
  assert.match(path, /L35 0 Q40 -10 45 0 L45 0 Q50 -10 55 0 L55 0 Q60 -10 65 0/);
  assert.ok(path.endsWith('L100 0'));
});

test('a crossing near a bend is bridged inside its segment', () => {
  const path = routePath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], [
    { x: 2, y: 0 }, { x: 18, y: 0 }, { x: 20, y: 3 },
  ]);
  assert.equal((path.match(/Q/g) || []).length, 3);
  assert.match(path, /L0 0 Q2 -10 4 0/);
  assert.match(path, /L16 0 Q18 -10 20 0/);
  assert.match(path, /L20 0 Q10 3 20 6/);
});

test('reverse-direction bridges preserve endpoints and crossing ownership', () => {
  const path = routePath([{ x: 0, y: 30 }, { x: 0, y: 0 }], [
    { x: 0, y: 10 }, { x: 0, y: 20 }, { x: 0, y: 20, otherWireId: 'another' },
  ]);
  assert.equal((path.match(/Q/g) || []).length, 2);
  assert.match(path, /^M0 30 L0 25 Q-10 20 0 15 L0 15 Q-10 10 0 5 L0 0$/);
  assert.equal(routePath([]), '');
  assert.equal(routePath([{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 10, y: 5 }]), 'M0 0 L20 0');
});
