const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed MS-DOS timestamp keeps archives byte-for-byte reproducible for the same report.
const ZIP_TIME = 0;
const ZIP_DATE = 0x0021;

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Store-only ZIP: JPEGs and JSON are already compressed, and no dependencies are needed. */
export function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name);
    const bytes = data instanceof Uint8Array ? data : encoder.encode(String(data));
    const checksum = crc32(bytes);
    const header = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(header.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, 0, true); // stored
    localView.setUint16(10, ZIP_TIME, true);
    localView.setUint16(12, ZIP_DATE, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    local.push(header, bytes);

    const record = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(record.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true); // stored
    centralView.setUint16(12, ZIP_TIME, true);
    centralView.setUint16(14, ZIP_DATE, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    central.push(record);
    offset += header.length + bytes.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, central.reduce((sum, record) => sum + record.length, 0), true);
  endView.setUint32(16, offset, true);
  return concat([...local, ...central, end]);
}

function dataUrlBytes(dataUrl) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Local export: report metadata, the screenshot as a real image file and, when
 * opted in, the sortie report as separate JSON. Delivery still sends one JSON
 * event with the same attachments embedded for PostHog.
 */
export function buildFeedbackArchive(report) {
  const properties = { ...(report?.properties ?? {}) };
  const entries = [];
  const screenshot = typeof properties.screenshot === 'string' ? dataUrlBytes(properties.screenshot) : null;
  if (screenshot) entries.push({ name: 'screenshot.jpg', data: screenshot });
  if (properties.fullReport && typeof properties.fullReport === 'object') {
    entries.push({ name: 'full-report.json',
      data: encoder.encode(JSON.stringify(properties.fullReport, null, 2)) });
  }
  const manifest = entries.map(entry => ({ path: entry.name }));
  const localProperties = { ...properties, attachments: manifest };
  delete localProperties.screenshot;
  delete localProperties.fullReport;
  entries.unshift({ name: 'report.json',
    data: encoder.encode(JSON.stringify({ ...report, properties: localProperties }, null, 2)) });
  return { bytes: createZip(entries), entries: entries.map(entry => entry.name) };
}
