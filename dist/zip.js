// PNGs are already compressed. ZIP's STORE method keeps their original bytes
// and avoids a browser dependency or a second compression pass.
const ZIP32_LIMIT = 0xffffffff;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size, signature) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

function fileNameBytes(name) {
  // This exporter creates a flat archive, so no entry needs path separators.
  if (typeof name !== 'string' || !name.trim() || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('ZIP entries need a safe, non-empty filename without folders.');
  }
  const bytes = encoder.encode(name);
  if (bytes.length > 0xffff) throw new Error('A ZIP filename is too long.');
  return bytes;
}

/** Build one ordinary UTF-8 ZIP download from [{ name, blob }], in entry order. */
export async function createZip(entries, assertCurrent = () => {}) {
  assertCurrent();
  if (!Array.isArray(entries)) throw new TypeError('ZIP entries must be an array.');
  if (entries.length >= 0xffff) throw new Error('Too many files for one ZIP download.');
  const names = new Set();
  let archiveSize = 22;
  const files = entries.map(entry => {
    const name = fileNameBytes(entry?.name), key = entry.name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate ZIP filename: ${entry.name}`);
    names.add(key);
    if (!(entry.blob instanceof Blob)) throw new TypeError('Each ZIP entry must contain a Blob.');
    if (entry.blob.size >= ZIP32_LIMIT) throw new Error('A file is too large for this ZIP download.');
    archiveSize += 30 + 46 + name.length * 2 + entry.blob.size;
    if (archiveSize >= ZIP32_LIMIT) throw new Error('The ZIP is too large. Export fewer modules or use a smaller resolution.');
    return { name, blob: entry.blob };
  });
  const now = new Date(), year = Math.max(1980, Math.min(2107, now.getFullYear()));
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const localParts = [], centralParts = [];
  let offset = 0, centralSize = 0;
  for (const { name, blob } of files) {
    assertCurrent();
    const data = await blob.arrayBuffer();
    assertCurrent();
    const checksum = crc32(new Uint8Array(data));
    const local = header(30, 0x04034b50), lv = local.view;
    lv.setUint16(4, 20, true); // ZIP 2.0
    lv.setUint16(6, 0x0800, true); // UTF-8 filenames
    lv.setUint16(10, time, true); lv.setUint16(12, date, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, blob.size, true); lv.setUint32(22, blob.size, true);
    lv.setUint16(26, name.length, true);
    localParts.push(local.bytes, name, blob);

    const central = header(46, 0x02014b50), cv = central.view;
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, blob.size, true); cv.setUint32(24, blob.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    centralParts.push(central.bytes, name);
    offset += 30 + name.length + blob.size;
    centralSize += 46 + name.length;
  }
  const end = header(22, 0x06054b50), ev = end.view;
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  assertCurrent();
  return new Blob([...localParts, ...centralParts, end.bytes], { type: 'application/zip' });
}
