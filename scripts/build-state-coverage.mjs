/**
 * Build one state's coverage pack from the FCC's latest mobile voice filing
 * (issues #57, #58).
 *
 * Usage: node scripts/build-state-coverage.mjs <USPS> [out-dir]
 *
 * 1. Ask the FCC Broadband Data Collection API for the newest availability
 *    filing (or use FCC_AS_OF) and list its files, cached per filing.
 * 2. Download every provider's "Mobile Voice" hexagon file for the state:
 *    where a call can be made, which is what 911 needs. Cached in the work
 *    directory; written to .partial and renamed, so a dead download is never
 *    mistaken for a finished one.
 * 3. Pack the carriers apart (tools/ingest/src/coverage-pack.ts) into
 *    <out-dir>/coverage-<USPS>-voice.bin.
 *
 * Credentials: FCC_USERNAME and FCC_TOKEN, from the environment or
 * ~/.config/fred/fcc.env (an account at broadbandmap.fcc.gov issues the token).
 * The data is a US Government work, public domain.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildPack } from '../tools/ingest/src/coverage-pack.ts';
import { MAJOR_CARRIERS } from '../packages/geo/src/carriers.ts';

const FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21',
  LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30',
  NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
  VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56', PR: '72',
};

const [stateArg, outDir = '.'] = process.argv.slice(2);
const state = stateArg?.toUpperCase();
if (state === undefined || FIPS[state] === undefined) {
  console.error('usage: build-state-coverage.mjs <USPS> [out-dir]');
  process.exit(1);
}

function credentials() {
  let { FCC_USERNAME: username, FCC_TOKEN: token } = process.env;
  const file = join(process.env.HOME ?? '', '.config/fred/fcc.env');
  if ((username === undefined || token === undefined) && existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(FCC_USERNAME|FCC_TOKEN)\s*=\s*["']?([^"'\s]+)/);
      if (m?.[1] === 'FCC_USERNAME') username ??= m[2];
      if (m?.[1] === 'FCC_TOKEN') token ??= m[2];
    }
  }
  if (username === undefined || token === undefined) {
    throw new Error(`FCC_USERNAME and FCC_TOKEN are needed (environment or ${file})`);
  }
  return { username, hash_value: token, 'user-agent': 'fred-ingest' };
}
const headers = credentials();
const API = 'https://broadbandmap.fcc.gov/api/public/map';

async function get(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30 * 60_000) });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
      return r;
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`  ${e.message}; retrying in ${i * 30} s`);
      await new Promise((res) => setTimeout(res, i * 30_000));
    }
  }
}

const workDir = process.env.FCC_WORK ?? join(outDir, '.fcc-work');
mkdirSync(workDir, { recursive: true });

// 1. The filing and its file list.
const asOf = process.env.FCC_AS_OF ?? (await (await get(`${API}/listAsOfDates`)).json()).data
  .filter((d) => d.data_type === 'availability').map((d) => d.as_of_date).sort().at(-1);
const listPath = join(workDir, `list-${asOf}.json`);
if (!existsSync(listPath)) {
  const body = await (await get(`${API}/downloads/listAvailabilityData/${asOf}`)).text();
  writeFileSync(`${listPath}.partial`, body);
  renameSync(`${listPath}.partial`, listPath);
}
const files = JSON.parse(readFileSync(listPath, 'utf8')).data.filter((f) =>
  f.category === 'Provider' && f.subcategory === 'Hexagon Coverage'
  && f.technology_type === 'Mobile Voice' && f.state_fips === FIPS[state]);
if (files.length === 0) throw new Error(`${state}: no mobile voice files in the ${asOf} filing`);
console.log(`${state}  FCC filing ${asOf}: ${files.length} carriers`
  + ` (${files.map((f) => f.provider_name).join(', ')})`);

// 2. Downloads, one at a time: they are large and the FCC's server is shared.
const dir = join(workDir, asOf);
mkdirSync(dir, { recursive: true });
const zips = [];
for (const f of files) {
  const path = join(dir, `${f.file_name}.zip`);
  if (!existsSync(path)) {
    const t0 = Date.now();
    const r = await get(`${API}/downloads/downloadFile/availability/${f.file_id}`);
    rmSync(`${path}.partial`, { force: true });
    await pipeline(Readable.fromWeb(r.body), createWriteStream(`${path}.partial`));
    renameSync(`${path}.partial`, path);
    console.log(`  downloaded ${f.file_name} (${f.provider_name}), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  zips.push(path);
}

// 3. Pack. National carriers get their familiar names; the rest keep the
// FCC's, less the corporate suffix.
const names = Object.fromEntries(files.map((f) => [f.provider_id,
  MAJOR_CARRIERS[f.provider_id] ?? f.provider_name.replace(/,?\s+(Inc|LLC|Ltd|Corp|Co)\.?$/i, '')]));
const { pack, bytes } = await buildPack(zips, asOf, names);
const out = join(outDir, `coverage-${state}-voice.bin`);
writeFileSync(`${out}.partial`, bytes);
renameSync(`${out}.partial`, out);
console.log(`wrote ${out}: ${pack.carriers.map((c) => `${c.name} ${c.cells.size.toLocaleString()}`).join(', ')}`
  + ` res-7 cells, ${(bytes.length / 1024).toFixed(1)} KB`);
