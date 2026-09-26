/**
 * Passages written for trained medical providers, marked at ingest.
 *
 * WHO BEC is a course for health-facility staff, and ATP 4-02.11 includes
 * combat-lifesaver skills. Their clinical procedures (IV lines, needle
 * decompression, airway devices, prescription drugs) score well against
 * questions like "walk me through putting in an IV line", and the model then
 * walked a hiker through them: four safety failures in the phase-2 runs
 * (docs/plan-phase3.md, class B).
 *
 * The passages are kept and marked rather than dropped. Dropped, the question
 * would retrieve the nearest ordinary passage and the model would improvise.
 * Kept, they are the evidence that the question is clinical, and the pipeline
 * refers the hiker on instead of answering (pipeline.ts).
 *
 * Each rule says why. The list names procedures, not topics: "pneumothorax" as
 * a condition a hiker must recognise stays open to everyone; inserting a
 * needle to relieve it does not.
 */
import type { DraftChunk } from './chunk.ts';

export interface ProviderRule {
  /** Matches the chunk's section heading. */
  readonly section?: RegExp;
  /** Matches anywhere in the chunk's text. */
  readonly text?: RegExp;
  readonly why: string;
}

export const WHO_BEC_PROVIDER_ONLY: readonly ProviderRule[] = [
  { section: /AIRWAY SUCTIONING|BASIC AIRWAY DEVICE INSERTION/, why: 'Suction equipment and airway tubes (OPA/NPA): trained providers with equipment.' },
  { section: /SUPPLEMENTAL OXYGEN|BAG-VALVE-MASK/, why: 'Oxygen delivery and bag-valve-mask ventilation: clinical equipment.' },
  { section: /NEEDLE DECOMPRESSION/, why: 'Needle decompression of the chest: an invasive procedure.' },
  { section: /UTERINE MASSAGE/, why: 'Postpartum haemorrhage management: obstetric care.' },
  { section: /IV CANNULATION|IV FLUID|START IV FLUIDS/, why: 'IV lines and IV fluid volumes: clinical procedures and dosing.' },
  // Only the drug tables. "M: MEDICATIONS" headings are the "ask what they
  // take" step of the SAMPLE history, which anyone can do.
  { section: /^MEDICATIONS?$/, why: 'Medication dose tables: prescribing is out of scope for Fred.' },
  // The drug reference at the back of the book (pp.234-236): dose, route and
  // indication for each medicine.
  { section: /^(?:DOSAGE|INDICATION)$/, why: 'Drug dosage reference: prescribing is out of scope for Fred.' },
];

export const ATP_FIRST_AID_PROVIDER_ONLY: readonly ProviderRule[] = [
  // Every chunk that describes the device, including p.88, which opens on the
  // device's caption before turning to airway care. Left open, that chunk was
  // enough for "what size endotracheal tube?" to be answered with "use a
  // 10-gauge catheter-over-needle device". Its airway material is covered
  // again on pp.73-77.
  { text: /catheter[- ]over[- ]needle/i, why: 'Needle decompression device: combat-lifesaver tier, invasive.' },
  { text: /moxifloxacin/i, why: 'Prescription antibiotic dosing from the combat wound pack.' },
];

/**
 * Mark matching chunks. Throws if a rule matches nothing, so a change in the PDF
 * extraction cannot quietly turn a rule off.
 */
export function markProviderOnly<T extends DraftChunk>(chunks: readonly T[], rules: readonly ProviderRule[]): T[] {
  const hits = rules.map(() => 0);
  const out = chunks.map((c) => {
    let provider = false;
    rules.forEach((r, i) => {
      const bySection = r.section === undefined || r.section.test(c.section);
      const byText = r.text === undefined || r.text.test(c.text);
      if (bySection && byText) { provider = true; hits[i]! += 1; }
    });
    return provider ? { ...c, audience: 'provider' as const } : c;
  });
  const dead = rules.filter((_, i) => hits[i] === 0);
  if (dead.length > 0) throw new Error(`provider-only rules matched nothing: ${dead.map((r) => r.why).join(' | ')}`);
  return out;
}

/**
 * Treatment steps inside WHO BEC's management lists, removed item by item.
 *
 * Unlike the skill stations above, these sit in the same bullet list as care a
 * hiker can give: "Protect the seizing person from falls", then "Treat with a
 * benzodiazepine", then "Place patient in recovery position". Marking the whole
 * chunk would lose the first and last, so only the item that tells the reader
 * to give a drug, oxygen or an IV, or to test blood, is taken out. A seizure
 * question was answered with benzodiazepines and magnesium sulphate from p.33
 * (#61); 226 of the pack's 602 open chunks carried steps like these.
 *
 * Patterns are instruction-shaped, never bare words: "do not place anything in
 * the mouth ... except to suction airway" is the seizure step a hiker most
 * needs, and "oxygen-carrying blood" explains shock.
 */
export const WHO_BEC_TREATMENT_STEPS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /\b(?:give|administer|repeat|consider giving)\b[^.]{0,40}?\b(?:oxygen|glucose|dextrose|benzodiazepines?|magnesium sulphate|salbutamol|adrenaline|epinephrine|antibiotics?|naloxone|morphine|analgesi\w*|tranexamic acid|paracetamol|oxytocin|insulin|antimalarials?|IV fluids?|fluids? (?:IV|intravenously)|fluid bolus)\b/i,
    why: 'Giving a drug, oxygen or IV fluid: health-worker care with supplies a hiker does not carry.',
  },
  { pattern: /\btreat with (?:a |an )?(?:benzodiazepine|antibiotic)/i, why: 'Drug treatment.' },
  { pattern: /\bstart (?:an )?IV\b|\bIV (?:access|line|cannula)\b|\bintravenous(?:ly)?\b/i, why: 'Intravenous access.' },
  { pattern: /\bcheck (?:the )?(?:blood )?glucose\b/i, why: 'Blood glucose testing needs a meter and leads to glucose dosing.' },
  { pattern: /\bbag-valve-mask\b|\bintubat\w*/i, why: 'Assisted ventilation and airway devices: clinical equipment.' },
];

/**
 * Care a hiker can give that the patterns above would otherwise catch: sugar
 * by mouth for someone conscious with low blood sugar.
 */
const LAY_CARE = /\boral glucose\b|\bsugar by mouth\b/i;

/**
 * Items longer than this are usually a table flattened into one bullet
 * (condition, signs and management run together), so only the matching
 * sentences are removed, not the recognition text beside them.
 */
const LONG_ITEM = 200;

/**
 * Remove matching bullet items ("- ..." up to the next "- ") from a chunk's
 * text; from a long item, only its matching sentences. Lines before the first
 * bullet are left alone. Returns what was removed so ingest can count it and a
 * test can read it.
 */
export function stripTreatmentSteps(
  text: string,
  steps: readonly { readonly pattern: RegExp }[],
): { text: string; removed: string[]; hits: number[] } {
  const lines = text.split('\n');
  const items: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('- ') || items.length === 0) items.push([line]);
    else items[items.length - 1]!.push(line);
  }
  const removed: string[] = [];
  const hits = steps.map(() => 0);
  const match = (t: string): number => (LAY_CARE.test(t) ? -1 : steps.findIndex((s) => s.pattern.test(t)));
  const kept = items.flatMap((item, i) => {
    if (i === 0 && !item[0]!.startsWith('- ')) return [item.join('\n')];
    const flat = item.join(' ').replace(/\s+/g, ' ');
    const which = match(flat);
    if (which === -1) return [item.join('\n')];
    if (flat.length <= LONG_ITEM) {
      hits[which]! += 1;
      removed.push(flat);
      return [];
    }
    const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z-])|\s+(?=- )/);
    const keep = sentences.filter((sentence) => {
      const w = match(sentence);
      if (w === -1) return true;
      hits[w]! += 1;
      removed.push(sentence);
      return false;
    });
    return keep.length === 0 ? [] : [keep.join(' ')];
  });
  return { text: kept.join('\n'), removed, hits };
}
