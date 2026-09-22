/**
 * Build a B-KR3 coverage pack from FCC Broadband Data Collection downloads.
 *
 *   node tools/ingest/src/coverage-pack.ts <out.json> <file.shp.zip>...
 *
 * The FCC publishes mobile coverage as zipped shapefiles whose attribute table
 * carries an `h3_res9_id` per row. **Only the .dbf is read.** The .shp holds the
 * hexagon geometry and is roughly a third of the archive; H3 indices are
 * self-locating, so the geometry is dead weight here and decoding it would mean
 * a GIS dependency for nothing.
 *
 * Res 9 collapses to res 7 (`packages/geo/src/coverage.ts`), which matches
 * B-KR3's ±1 km rubric at 49x fewer cells. Carriers are unioned: B-KR3 asks
 * whether signal is plausible, not whose.
 *
 * The DBF field layout is parsed from the file header rather than hardcoded,
 * because the FCC reissues these per filing round and a silently shifted offset
 * would produce plausible-looking garbage rather than an error.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { cellToParent } from 'h3-js';
import { COVERAGE_RES, encodeCells } from '@fred/geo';
import { execFileSync } from 'node:child_process';

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

async function cellsFrom(zipPath: string, into: Set<string>): Promise<number> {
  // unzip is not installed everywhere; Python's zipfile is, and streaming the
  // dbf out beats materialising a 686 MB file per carrier.
  const dbfName = execFileSync('python3', ['-c',
    `import zipfile,sys;print([n for n in zipfile.ZipFile(sys.argv[1]).namelist() if n.endswith('.dbf')][0])`,
    zipPath]).toString().trim();
  const tmp = `${zipPath}.dbf`;
  execFileSync('python3', ['-c',
    `import zipfile,sys,shutil
z=zipfile.ZipFile(sys.argv[1])
with z.open(sys.argv[2]) as f, open(sys.argv[3],'wb') as o: shutil.copyfileobj(f,o,1<<22)`,
    zipPath, dbfName, tmp]);

  const fh = await open(tmp, 'r');
  const head = Buffer.alloc(4096);
  await fh.read(head, 0, 4096, 0);
  const { records, headerLength, recordLength, fields } = parseHeader(head);
  const h3 = fields.find((f) => f.name === 'h3_res9_id');
  if (h3 === undefined) throw new Error(`${zipPath}: no h3_res9_id field; layout changed`);
  await fh.close();

  let seen = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(tmp, { start: headerLength, highWaterMark: 1 << 22 });
    let carry = Buffer.alloc(0);
    stream.on('data', (chunk: string | Buffer) => {
      const buf: Buffer = carry.length === 0
        ? Buffer.from(chunk as Buffer) : Buffer.concat([carry, chunk as Buffer]);
      let p = 0;
      for (; p + recordLength <= buf.length; p += recordLength) {
        const id = buf.subarray(p + h3.offset, p + h3.offset + h3.length).toString('latin1').trim();
        if (id.length > 0) { into.add(cellToParent(id, COVERAGE_RES)); seen++; }
      }
      carry = Buffer.from(buf.subarray(p));
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  execFileSync('rm', ['-f', tmp]);
  if (seen !== records) console.warn(`  warning: read ${seen} of ${records} records`);
  return seen;
}

const [out, ...inputs] = process.argv.slice(2);
if (out === undefined || inputs.length === 0) {
  throw new Error('usage: coverage-pack.ts <out.json> <file.shp.zip>...');
}
const cells = new Set<string>();
for (const f of inputs) {
  const before = cells.size;
  const n = await cellsFrom(f, cells);
  console.log(`${f.split('/').pop()}: ${n.toLocaleString()} res-9 rows -> +${(cells.size - before).toLocaleString()} new res-7 cells`);
}
// Delta varints, gzipped. Measured 8,833 bytes for AT&T's California LTE
// footprint against 1,204,963 as a JSON array of ids — see coverage-codec.ts.
const packed = gzipSync(encodeCells([...cells]), { level: 9 });
writeFileSync(out, packed);
console.log(`\n${cells.size.toLocaleString()} res-7 cells -> ${out}`
  + ` (${(packed.length / 1024).toFixed(1)} KB)`);
