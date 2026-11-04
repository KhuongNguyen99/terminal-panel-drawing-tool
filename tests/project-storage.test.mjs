import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoredProject } from '../dist/project-storage.js';

const KEY = 'wirebench-project-v1';
const valid = JSON.stringify({ version: 1, title: 'Saved wiring' });
const normalize = value => {
  if (value.version !== 1) throw new Error('Unsupported project');
  return value;
};
const createDefault = () => ({ version: 1, title: 'Default wiring' });

function fakeStorage(initial = {}, rejectSet = () => false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (rejectSet(key)) throw new Error('Storage is full');
      values.set(key, String(value));
    },
  };
}

test('missing and valid autosaves load without making a recovery copy', () => {
  const storage = fakeStorage();
  assert.deepEqual(loadStoredProject(storage, KEY, normalize, createDefault), {
    project: createDefault(), recovery: null, autosaveBlocked: false,
  });
  storage.setItem(KEY, valid);
  assert.deepEqual(loadStoredProject(storage, KEY, normalize, createDefault), {
    project: JSON.parse(valid), recovery: null, autosaveBlocked: false,
  });
  assert.equal(storage.values.size, 1);
});

test('invalid autosave is copied under a unique key before autosave can resume', () => {
  const invalid = '{broken';
  const storage = fakeStorage({ [KEY]: invalid });
  const loaded = loadStoredProject(storage, KEY, normalize, createDefault);
  assert.deepEqual(loaded.project, createDefault());
  assert.equal(loaded.autosaveBlocked, false);
  assert.equal(loaded.recovery.raw, invalid);
  assert.match(loaded.recovery.message, /recovery file/i);
  const pointer = storage.getItem(`${KEY}-recovery`);
  assert.match(pointer, new RegExp(`^${KEY}-recovery-`));
  assert.equal(storage.getItem(pointer), invalid);
  assert.equal(storage.getItem(KEY), invalid, 'loading never overwrites the original autosave');
});

test('backup or pointer write failure blocks autosave and retains original raw data', () => {
  for (const rejectSet of [key => key.startsWith(`${KEY}-recovery-`), key => key === `${KEY}-recovery`]) {
    const invalid = JSON.stringify({ version: 2, title: 'My work' });
    const storage = fakeStorage({ [KEY]: invalid }, rejectSet);
    const loaded = loadStoredProject(storage, KEY, normalize, createDefault);
    assert.equal(loaded.autosaveBlocked, true);
    assert.equal(loaded.recovery.raw, invalid);
    assert.equal(storage.getItem(KEY), invalid);
    assert.equal(storage.getItem(`${KEY}-recovery`), null);
  }
});

test('a second invalid startup never overwrites the first recovery copy', () => {
  const storage = fakeStorage({ [KEY]: '{first' });
  loadStoredProject(storage, KEY, normalize, createDefault);
  const firstKey = storage.getItem(`${KEY}-recovery`);
  storage.setItem(KEY, '{second');
  loadStoredProject(storage, KEY, normalize, createDefault);
  const secondKey = storage.getItem(`${KEY}-recovery`);
  assert.notEqual(secondKey, firstKey);
  assert.equal(storage.getItem(firstKey), '{first');
  assert.equal(storage.getItem(secondKey), '{second');
  assert.equal(storage.getItem(KEY), '{second');
});

test('recovery stays discoverable after a later valid autosave', () => {
  const storage = fakeStorage({ [KEY]: '{broken' });
  loadStoredProject(storage, KEY, normalize, createDefault);
  storage.setItem(KEY, valid);
  const loaded = loadStoredProject(storage, KEY, normalize, createDefault);
  assert.deepEqual(loaded.project, JSON.parse(valid));
  assert.equal(loaded.recovery.raw, '{broken');
  assert.equal(loaded.autosaveBlocked, false);
});

test('unavailable storage falls back to the default without enabling autosave', () => {
  const storage = { getItem() { throw new Error('Storage unavailable'); } };
  assert.deepEqual(loadStoredProject(storage, KEY, normalize, createDefault), {
    project: createDefault(), recovery: null, autosaveBlocked: true,
  });
});
