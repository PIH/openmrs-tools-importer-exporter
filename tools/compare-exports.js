#!/usr/bin/env node
// Compares two patient export directories without revealing their content.
//
//   node tools/compare-exports.js <dirA> <dirB> [--limit N]
//
// For every *_patient.json file in either directory, it parses the JSON, sorts object keys and
// compares hashes, so formatting differences (indentation, key order) don't count. It prints only
// counts, total sizes, and, for files that differ, the JSON key paths that differ (array indices
// collapsed to []), with how many files each path differs in. It never prints values, file names or
// UUIDs: the files hold real patient data.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args.splice(limitIndex, 2)[1]) : 30;
const [dirA, dirB] = args;
if (!dirA || !dirB) {
  console.error('Usage: node tools/compare-exports.js <dirA> <dirB> [--limit N]');
  process.exit(2);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

// Collects the key paths where a and b differ (array indices collapsed to []).
function diffPaths(a, b, prefix, out) {
  if (JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))) {
    return;
  }
  const bothArrays = Array.isArray(a) && Array.isArray(b);
  const bothObjects = !bothArrays && a && b && typeof a === 'object' && typeof b === 'object'
    && !Array.isArray(a) && !Array.isArray(b);
  if (bothArrays) {
    if (a.length !== b.length) {
      out.add(`${prefix || '(root)'} (array length differs)`);
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      diffPaths(a[i], b[i], `${prefix}[]`, out);
    }
  } else if (bothObjects) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (!(key in a)) {
        out.add(`${p} (only in B)`);
      } else if (!(key in b)) {
        out.add(`${p} (only in A)`);
      } else {
        diffPaths(a[key], b[key], p, out);
      }
    }
  } else {
    out.add(`${prefix || '(root)'} (value differs)`);
  }
}

async function listFiles(dir) {
  const names = await fs.readdir(dir);
  return new Set(names.filter(n => n.endsWith('_patient.json')));
}

async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  return { size: Buffer.byteLength(text), json: JSON.parse(text) };
}

const filesA = await listFiles(dirA);
const filesB = await listFiles(dirB);
const common = [...filesA].filter(f => filesB.has(f));
let identical = 0;
let different = 0;
let unreadable = 0;
let sizeA = 0;
let sizeB = 0;
const pathCounts = new Map();

for (const name of common) {
  let a;
  let b;
  try {
    a = await readJson(path.join(dirA, name));
    b = await readJson(path.join(dirB, name));
  } catch {
    unreadable++;
    continue;
  }
  sizeA += a.size;
  sizeB += b.size;
  if (hash(a.json) === hash(b.json)) {
    identical++;
  } else {
    different++;
    const paths = new Set();
    diffPaths(a.json, b.json, '', paths);
    for (const p of paths) {
      pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1);
    }
  }
}

const mb = bytes => (bytes / 1048576).toFixed(1);
console.log(`Files: ${filesA.size} in A, ${filesB.size} in B, ${common.length} in both`);
console.log(`Only in A: ${filesA.size - common.length}, only in B: ${filesB.size - common.length}`);
console.log(`Identical (after parsing): ${identical}; different: ${different}; unreadable: ${unreadable}`);
if (common.length > 0) {
  console.log(`Size of the files in both: A ${mb(sizeA)} MB, B ${mb(sizeB)} MB (B is ${(100 * sizeB / sizeA).toFixed(1)}% of A)`);
}
if (pathCounts.size > 0) {
  console.log(`Paths that differ (number of files), top ${limit}:`);
  for (const [p, n] of [...pathCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit)) {
    console.log(`  ${String(n).padStart(6)}  ${p}`);
  }
}
process.exit(different > 0 || unreadable > 0 || filesA.size !== filesB.size ? 1 : 0);
