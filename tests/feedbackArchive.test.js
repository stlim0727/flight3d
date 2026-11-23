import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { buildFeedbackArchive } from '../src/analytics/feedbackArchive.js';
import { createFeedbackReport } from '../src/analytics/feedbackReport.js';

const decode = bytes => new TextDecoder().decode(bytes);

function readStoredEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const name = decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + size);
    assert.equal(view.getUint32(offset + 14, true), zlibCrc32(data), `${name} CRC`);
    entries[name] = data;
    offset = start + size;
  }
  let directoryEntries = 0;
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
    directoryEntries += 1;
  }
  assert.equal(directoryEntries, Object.keys(entries).length, 'central directory entry count');
  assert.equal(view.getUint32(offset, true), 0x06054b50, 'archive ends with EOCD');
  assert.equal(view.getUint16(offset + 10, true), directoryEntries, 'EOCD entry count');
  return entries;
}

test('archive export separates report, screenshot and optional full report', () => {
  const screenshotBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]);
  const fullReport = { kind: 'flight3d.sortie.v1', report: { reason: 'landed', durationSec: 12 } };
  const draft = createFeedbackReport({ message: 'terrain artifact', context: {
    altitudeFt: 1200, headingDeg: 275, geoPosition: { latitude: 37.4, longitude: 126.4 },
  }, screenshot: `data:image/jpeg;base64,${screenshotBytes.toString('base64')}`, fullReport });
  const archive = buildFeedbackArchive(draft);
  assert.deepEqual(archive.entries, ['report.json', 'screenshot.jpg', 'full-report.json']);

  const files = readStoredEntries(archive.bytes);
  assert.deepEqual(files['screenshot.jpg'], new Uint8Array(screenshotBytes));
  assert.deepEqual(JSON.parse(decode(files['full-report.json'])), fullReport);

  const local = JSON.parse(decode(files['report.json']));
  assert.equal(local.reportId, draft.reportId);
  assert.equal(local.properties.altitudeFt, 1200);
  assert.equal(local.properties.headingDeg, 275);
  assert.equal(local.properties.geoPosition.latitude, 37.4);
  assert.equal(local.properties.screenshot, undefined);
  assert.equal(local.properties.fullReport, undefined);
  assert.deepEqual(local.properties.attachments, [
    { path: 'screenshot.jpg' }, { path: 'full-report.json' },
  ]);
  assert.equal(draft.properties.screenshot.startsWith('data:image/jpeg;base64,'), true,
    'delivery payload keeps the embedded screenshot');
});

test('archive export without attachments contains only the manifest report', () => {
  const draft = createFeedbackReport({ message: 'no attachments', context: { peakG: 2 } });
  const archive = buildFeedbackArchive(draft);
  assert.deepEqual(archive.entries, ['report.json']);
  const files = readStoredEntries(archive.bytes);
  assert.deepEqual(JSON.parse(decode(files['report.json'])).properties.attachments, []);
});
