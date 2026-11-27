// Checks that every complex obs (an obs with a valueComplex) in the imported patient files has its file on the
// target: GET <target>/ws/rest/v1/obs/<uuid>/value must answer 2xx. Run it after the complex_obs directory was copied.
// Missing ones are listed in LOG_HOME/complex-obs-missing.csv (obs_uuid,http_status). The file is always written, with its
// header even when nothing is missing, so an absent file means the check did not run. Always exits 0: the operator decides.
// If the check itself fails it logs "Complex obs check failed: <message>" (19-verify.sh looks for both lines).
// The core (collectComplexObsUuids, checkComplexObs) uses only node built-ins; the REST client and config are loaded by the CLI part.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Patient files move from successful to verified / failed_verification when verifyPatients.js has run
const PATIENT_DIRS = ['successful', 'verified', 'failed_verification'];
const REPORT_FILE = 'complex-obs-missing.csv';

/** Uuids of all obs with a valueComplex (group members at any depth) in <exportsDir>/{successful,verified,failed_verification}/*_patient.json. */
export function collectComplexObsUuids(exportsDir) {
  const uuids = new Set();
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (node.valueComplex != null && typeof node.uuid === 'string') uuids.add(node.uuid);
      Object.values(node).forEach(walk);
    }
  };
  for (const sub of PATIENT_DIRS) {
    const dir = path.join(exportsDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('_patient.json')) walk(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
    }
  }
  return uuids;
}

/** getStatus(url) resolves to the HTTP status; a rejection counts as missing with status "error". */
export async function checkComplexObs({ exportsDir, baseUrl, getStatus, concurrency = 10 }) {
  const uuids = [...collectComplexObsUuids(exportsDir)];
  const missing = [];
  let next = 0;
  const worker = async () => {
    while (next < uuids.length) {
      const uuid = uuids[next++];
      let status;
      try { status = await getStatus(`${baseUrl}/ws/rest/v1/obs/${uuid}/value`); } catch { status = 'error'; }
      if (!(typeof status === 'number' && status >= 200 && status < 300)) missing.push({ uuid, status });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, uuids.length) }, worker));
  return { checked: uuids.length, missing };
}

const csvField = value => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The report file content: the header, then one obs_uuid,http_status line per missing obs. */
export function complexObsReport(missing) {
  return ['obs_uuid,http_status', ...missing.map(m => `${csvField(m.uuid)},${csvField(m.status)}`)].join('\n') + '\n';
}

async function main() {
  const { default: config } = await import('./utils/config.js');
  const { default: logger } = await import('./utils/logger.js');
  const { fetchStatus } = await import('./services/openmrsService.js');
  const { checked, missing } = await checkComplexObs({
    exportsDir: config.TARGET_DIR,
    baseUrl: config.OPENMRS_TARGET_CONTEXT_PATH,
    getStatus: url => fetchStatus(url, 'TARGET'),
    concurrency: 10,
  });
  // Written from scratch, so a re-run does not add to the earlier list; header only when nothing is missing
  await fs.promises.mkdir(config.LOG_HOME, { recursive: true });
  await fs.promises.writeFile(path.join(config.LOG_HOME, REPORT_FILE), complexObsReport(missing));
  logger.info(`Complex obs check: ${checked} checked, ${missing.length} missing`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(`Complex obs check failed: ${err.message}`); process.exit(0); });
}
