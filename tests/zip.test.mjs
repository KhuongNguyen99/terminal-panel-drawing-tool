import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../dist/zip.js';

// Read the documented ZIP record layout independently of the writer. Checksums
// below use known CRC-32 vectors, rather than importing the writer's algorithm.
function readArchive(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'one disk');
  assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 8), bytes.readUInt16LE(end + 10));
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'no comment');
  const count = bytes.readUInt16LE(end + 10), centralStart = bytes.readUInt32LE(end + 16);
  assert.equal(centralStart + bytes.readUInt32LE(end + 12), end);
  let position = centralStart, localEnd = 0;
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(position), 0x02014b50);
    assert.equal(bytes.readUInt16LE(position + 8), 0x0800, 'UTF-8 flag');
    assert.equal(bytes.readUInt16LE(position + 10), 0, 'STORE method');
    const checksum = bytes.readUInt32LE(position + 16), size = bytes.readUInt32LE(position + 24);
    assert.equal(bytes.readUInt32LE(position + 20), size, 'stored size matches original');
    const nameLength = bytes.readUInt16LE(position + 28), name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    assert.equal(bytes.readUInt16LE(position + 30), 0);
    assert.equal(bytes.readUInt16LE(position + 32), 0);
    const local = bytes.readUInt32LE(position + 42);
    assert.equal(local, localEnd, 'all local records are contiguous and indexed');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 6), 0x0800);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    assert.equal(bytes.readUInt16LE(local + 10), bytes.readUInt16LE(position + 12), 'matching time');
    assert.equal(bytes.readUInt16LE(local + 12), bytes.readUInt16LE(position + 14), 'matching date');
    assert.equal(bytes.readUInt32LE(local + 14), checksum);
    assert.equal(bytes.readUInt32LE(local + 18), size);
    assert.equal(bytes.readUInt32LE(local + 22), size);
    assert.equal(bytes.readUInt16LE(local + 26), nameLength);
    assert.equal(bytes.readUInt16LE(local + 28), 0);
    assert.equal(bytes.subarray(local + 30, local + 30 + nameLength).toString('utf8'), name);
    localEnd = local + 30 + nameLength + size;
    files.push({ name, checksum, content: bytes.subarray(local + 30 + nameLength, localEnd) });
    position += 46 + nameLength;
  }
  assert.equal(position, end);
  assert.equal(localEnd, centralStart);
  return files;
}

test('ZIP stores multiple original byte streams, CRCs, UTF-8 names and directory offsets', async () => {
  const entries = [
    { name: '01-RIO-A-Slot-5.png', blob: new Blob(['123456789']) },
    { name: '02-Điện-阻值.png', blob: new Blob(['hello world']) },
    { name: '03-empty.png', blob: new Blob([]) },
    { name: '04-binary.png', blob: new Blob([Uint8Array.of(0, 1, 2, 3, 255)]) },
  ];
  const zip = await createZip(entries);
  assert.equal(zip.type, 'application/zip');
  const files = readArchive(Buffer.from(await zip.arrayBuffer()));
  assert.deepEqual(files.map(f => f.name), entries.map(e => e.name));
  assert.deepEqual(files.map(f => f.checksum), [0xcbf43926, 0x0d4a1185, 0, 0x7b35f858]);
  for (let i = 0; i < entries.length; i++) assert.deepEqual(files[i].content, Buffer.from(await entries[i].blob.arrayBuffer()));
});

test('ZIP supports a valid empty archive', async () => {
  const zip = await createZip([]);
  assert.equal(zip.size, 22);
  assert.deepEqual(readArchive(Buffer.from(await zip.arrayBuffer())), []);
});

test('ZIP rejects unsafe or duplicate names and malformed entries', async () => {
  const blob = new Blob(['x']);
  for (const name of ['', ' ', '.', '..', '../x.png', '/absolute.png', 'folder/file.png', 'folder\\file.png',
    'C:drive.png', 'file\0.png', 'file\n.png', 'a?.png', 'file.', 'file ', 'CON.png', 'LPT1.png']) {
    await assert.rejects(createZip([{ name, blob }]), /safe, non-empty filename/);
  }
  for (const pair of [['same.png', 'same.png'], ['same.png', 'SAME.PNG'], ['é.png', 'e\u0301.png']]) {
    await assert.rejects(createZip(pair.map(name => ({ name, blob }))), /Duplicate ZIP filename/);
  }
  await assert.rejects(createZip(null), /array/);
  await assert.rejects(createZip([null]), /filename/);
  await assert.rejects(createZip([{ name: 'ok.png', blob: 'text' }]), /Blob/);
  await assert.rejects(createZip([{ name: `${'é'.repeat(33000)}.png`, blob }]), /filename is too long/);
});

test('ZIP rejects ZIP64 counts and sizes before reading any large payload', async () => {
  await assert.rejects(createZip(new Array(0xffff)), /Too many files/);
  class OversizedBlob extends Blob { get size() { return 0xffffffff; } }
  await assert.rejects(createZip([{ name: 'large.png', blob: new OversizedBlob() }]), /file is too large/);
  class NearLimitBlob extends Blob { get size() { return 0xffffffff - 40; } }
  await assert.rejects(createZip([{ name: 'large.png', blob: new NearLimitBlob() }]), /ZIP is too large/);
});

test('ZIP cancellation after one file read prevents reading later files', async () => {
  let cancelled = false, reads = 0;
  const cancelledError = new Error('Export cancelled');
  class CancellingBlob extends Blob {
    async arrayBuffer() {
      reads++;
      const data = await super.arrayBuffer();
      cancelled = true;
      return data;
    }
  }
  class LaterBlob extends Blob {
    async arrayBuffer() { reads++; return super.arrayBuffer(); }
  }
  const entries = [
    { name: 'first.png', blob: new CancellingBlob(['first']) },
    { name: 'later.png', blob: new LaterBlob(['later']) },
  ];
  await assert.rejects(createZip(entries, () => { if (cancelled) throw cancelledError; }), error => error === cancelledError);
  assert.equal(reads, 1, 'packing stops before touching another PNG');
});
