/**
 * Build a coverage pack from FCC Broadband Data Collection downloads.
 *
 *   node tools/ingest/src/coverage-pack.ts <out.bin> <as-of> <file.shp.zip>...
 *
 * scripts/build-state-coverage.mjs fetches the files and calls `buildPack`;
 * the command line is for zips downloaded by hand.
 *
 * The FCC publishes mobile coverage as zipped shapefiles whose attribute table
 * carries an `h3_res9_id` per row. **Only the .dbf is read**, streamed straight
 * out of the zip. The .shp holds the hexagon geometry; H3 indices are
 * self-locating, so the geometry is dead weight here and decoding it would mean
 * a GIS dependency for nothing.
 *
 * Res 9 collapses to res 7 (`packages/geo/src/coverage.ts`), which matches
 * B-KR3's ±1 km rubric at 49x fewer cells. Carriers are kept apart, by the
 * `providerid` column (issue #58): the map warns where *your* carrier reports
 * nothing, and where *no* carrier does.
 *
 * The DBF field layout is parsed from the file header rather than hardcoded,
 * because the FCC reissues these per filing round and a silently shifted offset
 * would produce plausible-looking garbage rather than an error.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { cellToParent } from 'h3-js';
import { COVERAGE_RES, encodePack, type CoveragePack } from '@fred/geo/coverage';

interface DbfField { readonly name: string; readonly offset: number; readonly length: number }

/** Parse the DBF header: record count, record length, and where each field sits. */
function parseHeader(head: Buffer): {
  records: number; headerLength: number; recordLength: number; fields: DbfField[];
} {
  const records = head.readUInt32LE(4);
  const headerLength = head.readUInt16LE(8);
  const recordLength = head.readUInt16LE(10);
  const fields: DbfField[] = [];
  let offset = 1; // byte 0 of each record is the deletion flag
  for (let p = 32; p < headerLength - 1; p += 32) {
    if (head[p] === 0x0d) break;
    const name = head.subarray(p, p + 11).toString('latin1').replace(/\0.*$/, '');
    const length = head[p + 16]!;
    fields.push({ name, offset, length });
    offset += length;
  }
  return { records, headerLength, recordLength, fields };
}

/**
 * One file's reported cells, per provider id, collapsed to res 7.
 *
 * unzip is not installed everywhere; Python's zipfile is. It writes the .dbf to
 * a pipe, so a 700 MB table never lands on disk.
 */
export async function readCoverageZip(zipPath: string): Promise<Map<string, Set<string>>> {
  const py = spawn('python3', ['-c', `import zipfile,sys,shutil
z=zipfile.ZipFile(sys.argv[1])
n=[n for n in z.namelist() if n.endswith('.dbf')][0]
with z.open(n) as f: shutil.copyfileobj(f,sys.stdout.buffer,1<<22)`, zipPath],
  { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<number>((resolve) => py.on('close', (code) => resolve(code ?? 1)));

  const byProvider = new Map<string, Set<string>>();
  let buf: Buffer = Buffer.alloc(0);
  let layout: ReturnType<typeof parseHeader> | null = null;
  let h3: DbfField | undefined, prov: DbfField | undefined;
  let seen = 0;
  for await (const chunk of py.stdout) {
    buf = buf.length === 0 ? chunk as Buffer : Buffer.concat([buf, chunk as Buffer]);
    if (layout === null) {
      if (buf.length < 32 || buf.length < buf.readUInt16LE(8)) continue;
      layout = parseHeader(buf);
      h3 = layout.fields.find((f) => f.name === 'h3_res9_id');
      prov = layout.fields.find((f) => f.name === 'providerid');
      if (h3 === undefined || prov === undefined) {
        py.kill();
        throw new Error(`${zipPath}: no h3_res9_id or providerid field; layout changed`);
      }
      buf = buf.subarray(layout.headerLength);
    }
    const { recordLength } = layout;
    let p = 0;
    for (; p + recordLength <= buf.length; p += recordLength) {
      if (buf[p] === 0x1a) break; // end-of-file marker
      const id = buf.subarray(p + h3!.offset, p + h3!.offset + h3!.length).toString('latin1').trim();
      if (id.length === 0) continue;
      const who = buf.subarray(p + prov!.offset, p + prov!.offset + prov!.length).toString('latin1').trim();
      let cells = byProvider.get(who);
      if (cells === undefined) byProvider.set(who, cells = new Set());
      cells.add(cellToParent(id, COVERAGE_RES));
      seen++;
    }
    buf = buf.subarray(p);
  }
  const code = await exited;
  if (code !== 0) throw new Error(`${zipPath}: reading the .dbf failed (python exit ${code})`);
  if (layout === null) throw new Error(`${zipPath}: empty .dbf`);
  if (seen !== layout.records) {
    throw new Error(`${zipPath}: read ${seen} of ${layout.records} records; truncated download?`);
  }
  return byProvider;
}

/**
 * Merge files into one pack. Several files can carry one provider (a national
 * file and a state file, say); their cells are unioned. `names` labels ids.
 */
export async function buildPack(
  zips: readonly string[],
  asOf: string,
  names: Readonly<Record<string, string>> = {},
  log: (line: string) => void = () => {},
): Promise<{ pack: CoveragePack; bytes: Uint8Array }> {
  const all = new Map<string, Set<string>>();
  for (const z of zips) {
    for (const [id, cells] of await readCoverageZip(z)) {
      const into = all.get(id) ?? new Set<string>();
      for (const c of cells) into.add(c);
      all.set(id, into);
      log(`${z.split('/').pop()}: provider ${id}, ${cells.size.toLocaleString()} res-7 cells`);
    }
  }
  // Sorted by id, so the same inputs always produce the same bytes.
  const carriers = [...all].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, cells]) => ({ id, name: names[id] ?? id, cells }));
  const pack = { asOf, carriers };
  return { pack, bytes: gzipSync(encodePack(pack), { level: 9 }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, asOf, ...inputs] = process.argv.slice(2);
  if (out === undefined || asOf === undefined || inputs.length === 0) {
    throw new Error('usage: coverage-pack.ts <out.bin> <as-of> <file.shp.zip>...');
  }
  const { pack, bytes } = await buildPack(inputs, asOf, {}, console.log);
  writeFileSync(out, bytes);
  console.log(`${pack.carriers.length} carriers -> ${out} (${(bytes.length / 1024).toFixed(1)} KB)`);
}
