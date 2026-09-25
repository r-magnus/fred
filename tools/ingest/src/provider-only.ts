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
