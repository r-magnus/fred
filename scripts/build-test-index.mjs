/**
 * A download list for trying regional downloads (#224) without publishing
 * anything: the published index (states, core) plus the regions and the
 * nationwide overview built locally, all in <out-root>/assets/index.json.
 *
 * Usage: node scripts/build-test-index.mjs <base-url> [out-root] [published-index]
 *
 * <base-url> is where <out-root>/assets/ is served, e.g. http://127.0.0.1:8765/
 * with `adb reverse tcp:8765 tcp:8765` and any static server on the desktop.
 * Published states keep downloading from their real release: each gets the
 * published index's own baseUrl.
 *
 * The test app reads this list when built with
 * EXPO_PUBLIC_FRED_INDEX_URL=<base-url>index.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [baseUrl, outRoot = 'dist/regions', published = join(process.env.HOME, 'code', 'fred-maps', 'index.json')] = process.argv.slice(2);
if (baseUrl === undefined || !baseUrl.endsWith('/')) {
  console.error('usage: build-test-index.mjs <base-url ending in /> [out-root] [published-index]');
  process.exit(1);
}
const pub = JSON.parse(readFileSync(published, 'utf8'));
const states = Object.fromEntries(Object.entries(pub.states).map(([s, b]) => [s, { ...b, baseUrl: b.baseUrl ?? pub.baseUrl }]));

const regions = {};
for (const f of readdirSync(outRoot).filter((n) => /^index-[A-Z]{2}\.json$/.test(n))) {
  const frag = JSON.parse(readFileSync(join(outRoot, f), 'utf8'));
  regions[frag.state] = { base: frag.base, regions: frag.regions, outline: frag.outline };
}
const overviewFile = join(outRoot, 'US', 'bundle.json');
const overview = existsSync(overviewFile) ? JSON.parse(readFileSync(overviewFile, 'utf8')) : undefined;

const index = {
  ...pub,
  baseUrl,
  states,
  regions,
  ...(overview === undefined ? {} : { overview }),
};
writeFileSync(join(outRoot, 'assets', 'index.json'), JSON.stringify(index) + '\n');
console.log(`index.json: ${Object.keys(states).length} published states, regions for ${Object.keys(regions).join(', ') || 'none'}` +
  `${overview === undefined ? '' : ', the US overview'}; served from ${baseUrl}`);
