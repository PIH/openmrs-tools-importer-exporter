// Run with: node --test src/verifyComplexObs.test.js (built-ins only)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectComplexObsUuids, checkComplexObs, complexObsReport } from './verifyComplexObs.js';

function tmpExports() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobs-'));
  for (const d of ['successful', 'verified', 'failed_verification']) fs.mkdirSync(path.join(dir, d));
  return dir;
}
const write = (dir, sub, name, obj) => fs.writeFileSync(path.join(dir, sub, name), JSON.stringify(obj));

test('collects complex obs uuids, including group members, from all three folders', () => {
  const dir = tmpExports();
  write(dir, 'successful', 'a_patient.json', { encounters: [{ obs: [
    { uuid: 'ok-1', valueComplex: 'x.png|abc' },
    { uuid: 'grp', valueComplex: null, groupMembers: [{ uuid: 'gone-1', valueComplex: 'y.png|def', groupMembers: [] }] },
    { uuid: 'plain', value: 3 }] }] });
  write(dir, 'verified', 'b_patient.json', { obs: [{ uuid: 'ok-1', valueComplex: 'x.png|abc' }, { uuid: 'gone-2', valueComplex: 'z' }] });
  write(dir, 'failed_verification', 'c_patient.json', { obs: [{ uuid: 'ok-2', valueComplex: 'q' }] });
  write(dir, 'successful', 'notes.txt', {});
  assert.deepEqual([...collectComplexObsUuids(dir)].sort(), ['gone-1', 'gone-2', 'ok-1', 'ok-2']);
});

test('counts the obs whose value endpoint is not 2xx as missing', async () => {
  const dir = tmpExports();
  write(dir, 'successful', 'a_patient.json', { obs: [
    { uuid: 'ok-1', valueComplex: 'a' }, { uuid: 'gone-1', valueComplex: 'b' }, { uuid: 'ok-2', valueComplex: 'c' }, { uuid: 'bad-1', valueComplex: 'd' }] });
  const seen = [];
  let running = 0, peak = 0;
  const server = http.createServer((req, res) => {
    running++; peak = Math.max(peak, running); seen.push(req.url);
    setTimeout(() => { running--; const u = req.url;
      res.statusCode = u.includes('/gone-') ? 404 : u.includes('/bad-') ? 500 : 200; res.end('x'); }, 20);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/openmrs`;
  const getStatus = async url => (await fetch(url)).status;
  try {
    const result = await checkComplexObs({ exportsDir: dir, baseUrl: base, getStatus, concurrency: 2 });
    assert.equal(result.checked, 4);
    assert.deepEqual(result.missing.map(m => `${m.uuid},${m.status}`).sort(), ['bad-1,500', 'gone-1,404']);
    assert.ok(seen.every(u => u.startsWith('/openmrs/ws/rest/v1/obs/') && u.endsWith('/value')), seen.join());
    assert.ok(peak <= 2, `concurrency ${peak}`);
  } finally { server.close(); }
});

test('a request that throws counts as missing with status error', async () => {
  const dir = tmpExports();
  write(dir, 'successful', 'a_patient.json', { obs: [{ uuid: 'u1', valueComplex: 'a' }] });
  const r = await checkComplexObs({ exportsDir: dir, baseUrl: 'http://x', getStatus: async () => { throw new Error('boom'); }, concurrency: 10 });
  assert.deepEqual(r.missing, [{ uuid: 'u1', status: 'error' }]);
});

test('the report always has its header, so an absent file means the check did not run', () => {
  assert.equal(complexObsReport([]), 'obs_uuid,http_status\n');
  assert.equal(complexObsReport([{ uuid: 'u1', status: 404 }, { uuid: 'u,2', status: 'error' }]), 'obs_uuid,http_status\nu1,404\n"u,2",error\n');
});
