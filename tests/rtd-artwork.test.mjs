import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODULE_TYPES } from '../dist/modules.js';

test('RTD artwork terminal labels match the channel and physical pin targeted by every callout', async () => {
  const svg = await readFile(new URL('../dist/assets/module-ai-rtd.svg', import.meta.url), 'utf8');
  const terminals = Array.from(svg.matchAll(/<circle\b([^>]*\baria-label="CH[^"]+"[^>]*)\/>/g), match =>
    Object.fromEntries(Array.from(match[1].matchAll(/([\w-]+)="([^"]*)"/g), attribute => [attribute[1], attribute[2]])));
  assert.equal(terminals.length, 16);
  for (const port of MODULE_TYPES.AI_RTD.ports) {
    const terminal = terminals.find(terminal => terminal['aria-label'] === port.label);
    assert.ok(terminal, `artwork identifies ${port.label}`);
    assert.equal(Number(terminal.cx), port.side === 'left' ? 40.5 : 59);
    assert.ok(Math.abs(Number(terminal.cy) * 480 / 486 - port.pinY) < .001, `${port.label} targets its labeled image terminal`);
  }
});
