/**
 * The tips packs (#96, docs/plan-tips.md): everyday outdoor know-how.
 *
 *   node tools/ingest/src/tips-fetch.ts          # once: fetch and cache pages
 *   node tools/ingest/src/tips-pack.ts --dump    # cleaned chunks to corpora/tips/, no embedding
 *   node tools/ingest/src/tips-pack.ts
 *
 * Two packs, because the licences differ and share-alike must not reach NPS
 * text: core-tips-nps (public domain) and core-tips-wikivoyage (CC BY-SA 4.0,
 * one licence entry per article at the revision fetched, so every answer can
 * credit the article it quotes).
 *
 * What is kept is decided by section title, not by the test questions:
 * - NPS: the article body. Photo captions, share prompts and the Leave No Trace
 *   Center's copyrighted Seven Principles text are dropped (docs/licensing.md).
 * - Wikivoyage: prevention and how-to. Treatment of injury and illness,
 *   dangerous animals and rescue are dropped: an unreviewed source should not
 *   answer those, and the manuals and field cards already do. So are sections
 *   no hiker asks about (destinations, festivals, indoor pests).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainTag, LicenseEntry } from '@fred/pack-format';
import { looksLikeProcedure } from '@fred/rag-core';
import type { DraftChunk } from './chunk.ts';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import { writePack } from './pack.ts';
import { NPS_WILDLIFE_PAGES, npsSlug, WIKIVOYAGE_PAGES, type WikivoyagePage } from './tips-fetch.ts';

const DIR = 'corpora/tips';
/** Same window as the FEIS packs: room under the encoder's limit for the header. */
const TARGET_TOKENS = 280;

export const NPS_LICENSE: LicenseEntry = {
  id: 'nps',
  license: 'Public domain (US Government work)',
  sourceTitle: 'National Park Service articles (nps.gov)',
  sourceUrl: 'https://www.nps.gov/aboutus/disclaimer.htm',
  attribution: 'National Park Service, nps.gov. No protection is claimed in original U.S. Government works.',
  nonCommercial: false,
};

export function wikivoyageLicense(p: Pick<WikivoyagePage, 'title' | 'revid' | 'url'>): LicenseEntry {
  return {
    id: `wikivoyage:${p.title.replace(/ /g, '_')}`,
    license: 'CC-BY-SA-4.0',
    sourceTitle: `${p.title} (Wikivoyage, revision ${p.revid})`,
    sourceUrl: p.url,
    attribution: `"${p.title}" by Wikivoyage contributors, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Text only; shortened and split into passages.`,
    nonCommercial: false,
  };
}

/** Section titles never kept, at any level. Dropping a heading drops what is under it. */
const NPS_DROP = new Set([
  'pass it on!', 'pass it on', 'tags', 'bear safety articles', 'learn more!',
  'learn more about hiking in bear country', 'in collaboration with leave no trace', 'did you know?',
  'more information', 'related content', 'learn more', 'you might also like',
  // The Leave No Trace Center's copyrighted principles, listed verbatim.
  'the 7 principles of leave no trace', 'the seven principles of leave no trace',
  // Pointers to other NPS pages and booklets, with nothing to answer from.
  'trip planning guide', 'junior ranger park explorer',
]);

const WIKIVOYAGE_DROP = new Set([
  // Not what a hiker asks.
  'see also', 'destinations', 'get in', 'get around', 'buy', 'work', 'connect', 'events',
  'festivals', 'famous events', 'amazing things', 'talk', 'transport', 'heat shimmer and mirages',
  'fees and permits', 'by two-car shuttle', 'by public transit', 'ants', 'bedbugs', 'cockroaches',
  'fleas', 'lice', 'mites', 'birds', 'jellyfish', 'rodents', 'caterpillars and moths',
  'centipedes and millipedes', 'glamping', 'lodging',
  // Treatment, dangerous animals and rescue: left to reviewed sources.
  'medical issues', 'heat exhaustion', 'heatstroke', 'frostbite and hypothermia', 'emergencies',
  'dangerous animals', 'altitude sickness', 'poisonous plants', 'snakes', 'spiders', 'scorpions',
  'bees, hornets and wasps', 'wildfires', 'snow safety', 'ice safety', 'calling for help', 'rescue',
  'if you get stuck', 'medical supplies', 'first aid', 'how to remove a tick', 'leeches',
  'satellite phones and messengers', 'safety phones', 'mobile phones',
  // Backpacking's storm advice contradicts itself (open ground, then forest)
  // and the NPS lightning article; severe weather is left to reviewed sources.
  'weather',
]);

/**
 * Wikivoyage sections whose own text is dropped but whose subsections are kept.
 * "Ticks" describes tick-borne diseases and their treatment; its subsection
 * "How to prevent tick bites" is the part a tips pack should answer from.
 */
const WIKIVOYAGE_DROP_OWN = new Set(['ticks']);

const decode = (s: string): string =>
  s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;|&#8217;|&#8216;/g, "'").replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&deg;/g, '°').replace(/&mdash;|&#8212;/g, '—').replace(/&ndash;|&#8211;/g, '–').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

/** Markup to text, keeping paragraph and list-item breaks. */
function text(html: string): string {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<\/(p|li|tr|div|ul|ol|dd|dt)>|<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && l !== '-').join('\n');
}

export interface Section {
  /** Heading path below the page title, e.g. ["Sleep", "Campsites"]. */
  readonly path: readonly string[];
  readonly body: string;
}

/**
 * Split cleaned markup at h2-h4 headings into sections with heading paths.
 * A heading in `drop` removes its own text; with `cascade`, also every deeper
 * heading until one at its level or above. NPS needs cascade off: its "Contact
 * Us" is an h2 with the whole article in h3s after it, so cascading dropped
 * every article but the intro.
 */
export function sections(
  html: string, drop: ReadonlySet<string>, cascade: boolean, dropOwn: ReadonlySet<string> = new Set(),
): Section[] {
  const heads = [...html.matchAll(/<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g)];
  const out: Section[] = [];
  const intro = text(html.slice(0, heads[0]?.index ?? html.length));
  if (intro.length > 0) out.push({ path: [], body: intro });
  const stack: { level: number; title: string }[] = [];
  let droppedAt: number | null = null;
  heads.forEach((h, i) => {
    const level = Number(h[1]);
    const title = text(h[2] ?? '').replace(/\n/g, ' ').trim();
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    if (droppedAt !== null && level <= droppedAt) droppedAt = null;
    // "You Might Also Like" and its unrendered template headings are site navigation.
    const dropped = drop.has(title.toLowerCase()) || dropOwn.has(title.toLowerCase()) || /you might also like|meta\[/i.test(title);
    if (cascade && droppedAt === null && drop.has(title.toLowerCase())) droppedAt = level;
    if (title !== '') stack.push({ level, title });
    if (droppedAt !== null || dropped) return;
    const start = (h.index ?? 0) + h[0].length;
    const body = text(html.slice(start, heads[i + 1]?.index ?? html.length));
    if (body.length > 0) out.push({ path: stack.map((s) => s.title), body });
  });
  return out;
}

/** The article body of an NPS page, with photos, captions and share widgets removed. */
export function npsArticle(page: string): { title: string; html: string } {
  const title = decode(page.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
    .replace(/\s*\(U\.S\. National Park Service\)\s*$/, '').replace(/\s+/g, ' ').trim();
  // From the end of the tag that holds id="main": slicing at the attribute
  // left 'id="main" role="main" class="MainContent">' at the head of 27
  // passages in core-tips-nps 1.0.0.
  const at = page.indexOf('id="main"');
  const start = at < 0 ? -1 : page.indexOf('>', at) + 1;
  let html = start <= 0 ? page : page.slice(start);
  // The article ends where the series navigation, tags or page footer begin.
  const end = html.search(/Part of a series of articles titled|<footer|Last updated:|class="Tags/);
  if (end > 0) html = html.slice(0, end);
  html = html
    // The site's contact form sits in an h2 before the article. On pages whose
    // own headings are styled text rather than h-tags, everything after it
    // reads as the "Contact Us" section, so remove the heading, not the section.
    .replace(/<h\d[^>]*>\s*Contact Us\s*<\/h\d>/g, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/g, ' ')
    .replace(/<h1[\s\S]*?<\/h1>/g, ' ')
    // The Leave No Trace Center's copyright line and anything citing it.
    .replace(/<p[^>]*>[^<]*(?:©|Copyright)[\s\S]*?<\/p>/g, ' ');
  return { title, html };
}

/** Drop sentences that are someone else's copyrighted wording or dead ends. */
function keepLine(line: string): boolean {
  return !/©|Leave No Trace Center for Outdoor Ethics|Download or screenshot|Watch this .* video|Loading results|Narrow By Location/i.test(line);
}

/** Whole sentences packed into windows, each prefixed with its header. */
function windows(header: string, body: string, count: (t: string) => number): string[] {
  const units = body.split(/\n|(?<=[.!?])\s+(?=[A-Z("])/).map((s) => s.trim()).filter((s) => s !== '' && keepLine(s));
  const out: string[] = [];
  let cur: string[] = [];
  let tokens = count(header);
  const flush = (): void => {
    if (cur.length > 0) out.push(`${header}\n${cur.join('\n').replace(/\n(?!- )/g, ' ')}`);
    cur = [];
    tokens = count(header);
  };
  for (const u of units) {
    const n = count(u);
    if (tokens + n > TARGET_TOKENS && cur.length > 0) flush();
    cur.push(u);
    tokens += n;
  }
  flush();
  return out;
}

/** Too short to answer anything: a heading's one-line lead-in, a stray label. */
const MIN_BODY = 80;

export function pageChunks(
  title: string, secs: readonly Section[], count: (t: string) => number, licenseId?: string, minBody = MIN_BODY,
): DraftChunk[] {
  const chunks: DraftChunk[] = [];
  for (const s of secs) {
    if (s.body.length < minBody) continue;
    const section = [title, ...s.path].join(' > ');
    for (const t of windows([title, ...s.path].join(' — '), s.body, count)) {
      chunks.push({
        text: t,
        section,
        page: null,
        domain: 'outdoor-skills',
        blockKind: looksLikeProcedure(t) ? 'procedure' : 'prose',
        ...(licenseId === undefined ? {} : { licenseId }),
      });
    }
  }
  return chunks;
}

export function npsChunks(count: (t: string) => number, urls: readonly string[] = JSON.parse(readFileSync(join(DIR, 'nps', 'urls.json'), 'utf8')) as string[]): DraftChunk[] {
  return urls.flatMap((url) => {
    const { title, html } = npsArticle(readFileSync(join(DIR, 'nps', `${npsSlug(url)}.html`), 'utf8'));
    return pageChunks(title, sections(html, NPS_DROP, false), count);
  });
}

/** Wildlife-encounter pages (#117), as survival passages so an emergency can reach them. */
export function wildlifeChunks(count: (t: string) => number): DraftChunk[] {
  return npsChunks(count, NPS_WILDLIFE_PAGES)
    .filter((c) => !WILDLIFE_DROP.test(c.section))
    .map((c) => ({ ...c, domain: 'survival' as const }));
}

/**
 * Yellowstone's safety page covers far more than wildlife. Kept: wildlife in
 * general, bears (including food storage and a bear in camp), bison, elk,
 * wolves and cougars. Dropped: thermal areas and driving (not a hiker's
 * question here), weather (#115), ticks and mosquitoes (the health pack),
 * buying or renting bear spray, and pointers elsewhere.
 */
const WILDLIFE_DROP = /^Safety - Yellowstone National Park(?: > (?:Emergency\?|Find Out More|Thermal Areas|Driving|Ticks & Mosquitoes|Weather & Environment|Bears > (?:Buying|Renting) Bear Spray)(?:$| >)|$)|> More Resources$/;

export function wikivoyagePages(): WikivoyagePage[] {
  return WIKIVOYAGE_PAGES.map((t) =>
    JSON.parse(readFileSync(join(DIR, 'wikivoyage', `${t.replace(/[^a-z0-9]+/gi, '_')}.json`), 'utf8')) as WikivoyagePage);
}

export function wikivoyageChunks(pages: readonly WikivoyagePage[], count: (t: string) => number): DraftChunk[] {
  return pages.flatMap((p) => {
    const html = p.html
      .replace(/<figure[\s\S]*?<\/figure>/g, ' ')
      .replace(/<table[\s\S]*?<\/table>/g, ' ')
      .replace(/<div[^>]*class="[^"]*(?:hatnote|article-status|infobox|countryData|thumb)[^"]*"[\s\S]*?<\/div>/g, ' ')
      .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/g, ' ');
    return pageChunks(p.title, sections(html, WIKIVOYAGE_DROP, true, WIKIVOYAGE_DROP_OWN), count, wikivoyageLicense(p).id);
  });
}

async function main(): Promise<void> {
  const dump = process.argv.includes('--dump');
  const pages = wikivoyagePages();
  if (dump) {
    // A word count stands in for the encoder's tokens: close enough to review windows.
    const count = (t: string): number => Math.ceil(t.split(/\s+/).length * 1.3);
    mkdirSync(DIR, { recursive: true });
    for (const [name, chunks] of [['nps', npsChunks(count)], ['wikivoyage', wikivoyageChunks(pages, count)], ['wildlife', wildlifeChunks(count)]] as const) {
      writeFileSync(join(DIR, `chunks-${name}.json`), JSON.stringify(chunks, null, 1));
      console.log(`${name}: ${chunks.length} chunks -> ${join(DIR, `chunks-${name}.json`)}`);
    }
    return;
  }

  const embedder = await loadGgufEmbedder(EMBEDDING_GEMMA);
  const count = (t: string): number => embedder.tokenCount(t);
  const packs: { id: string; version: string; domains: DomainTag[]; displayName: string; source: string; description: string; licenseId: string; licenses: LicenseEntry[]; chunks: DraftChunk[] }[] = [
    {
      // 1.1.0: trail etiquette with horses, bikes and dogs (#117).
      id: 'core-tips-nps', version: '1.1.0', domains: ['outdoor-skills'], displayName: 'Outdoor Tips (National Park Service)', source: 'National Park Service',
      description: 'Everyday outdoor know-how from National Park Service articles: hiking, camping, food storage, wildlife distance, waste, etiquette.',
      licenseId: NPS_LICENSE.id, licenses: [NPS_LICENSE], chunks: npsChunks(count),
    },
    {
      id: 'core-tips-wikivoyage', version: '1.0.0', domains: ['outdoor-skills'], displayName: 'Outdoor Tips (Wikivoyage)', source: 'Wikivoyage',
      description: 'Everyday outdoor know-how from Wikivoyage travel topics, CC BY-SA 4.0: backpacking, hiking, camping, clothing, food, bugs.',
      licenseId: wikivoyageLicense(pages[0]!).id, licenses: pages.map(wikivoyageLicense), chunks: wikivoyageChunks(pages, count),
    },
  ];
  packs.push({
    id: 'core-wildlife-safety', version: '1.0.0', domains: ['survival', 'wildlife'], displayName: 'Wildlife Safety (National Park Service)', source: 'National Park Service',
    description: 'What to do when a mountain lion, moose, elk, bison, rattlesnake or coyote is close, from National Park Service park pages.',
    licenseId: NPS_LICENSE.id, licenses: [NPS_LICENSE], chunks: wildlifeChunks(count),
  });
  // PACKS_ONLY=a,b builds only those packs: a rebuild of an unchanged pack
  // is not a no-op when the cleaning code has moved on since it was built.
  const only = process.env.PACKS_ONLY?.split(',');
  for (const p of packs.filter((x) => only === undefined || only.includes(x.id))) {
    const vectors = await embedder.embed(p.chunks.map((c) => documentText(EMBEDDING_GEMMA, c.section, c.text)));
    const { dir, manifest } = await writePack(process.env.PACKS_OUT ?? 'packs', {
      id: p.id, version: p.version, displayName: p.displayName, description: p.description,
      domains: p.domains, scope: { kind: 'global' }, source: p.source,
      licenseId: p.licenseId, licenses: p.licenses, embedding: embedder.spec,
    }, p.chunks, vectors);
    const mb = manifest.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024;
    console.log(`wrote ${dir}: ${manifest.chunkCount} chunks, ${mb.toFixed(2)} MB`);
  }
  await embedder.dispose();
}

if (import.meta.main) await main();
