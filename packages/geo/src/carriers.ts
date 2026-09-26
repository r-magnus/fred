/**
 * Which network a phone is on, as an FCC provider id (issue #58).
 *
 * The coverage map shows where *your* carrier reports nothing, so it needs the
 * carrier the FCC files under, not the brand on the SIM: Mint, Visible and
 * Cricket file nothing; their customers ride T-Mobile, Verizon and AT&T.
 *
 * Android reports the SIM's MCC/MNC (the home network code) with no
 * permission, and for most MVNOs that code is the host network's, so it is
 * tried first. The SIM's display name is the fallback. iOS has returned no
 * carrier at all since iOS 16; there the user picks one.
 *
 * Unknown is an answer: null means "show only where no carrier reports
 * anything", never a guess.
 */

/** FCC Broadband Data Collection provider ids for the national networks. */
export const MAJOR_CARRIERS: Readonly<Record<string, string>> = {
  '130077': 'AT&T',
  '130403': 'T-Mobile',
  '131425': 'Verizon',
};

const ATT = '130077', TMOBILE = '130403', VERIZON = '131425';

/**
 * US home network codes (MCC 310-316) for the three national networks,
 * including the legacy Sprint and UScellular codes T-Mobile now runs and
 * AT&T's FirstNet. Regional carriers are left out on purpose: they file their
 * own coverage under ids this table cannot know.
 */
const MCC_MNC: Readonly<Record<string, string>> = {
  ...Object.fromEntries([
    '310030', '310070', '310080', '310090', '310150', '310170', '310280', '310380',
    '310410', '310560', '310680', '310950', '311180', '313100',
  ].map((c) => [c, ATT])),
  ...Object.fromEntries([
    '310120', '310160', '310200', '310210', '310220', '310230', '310240', '310250',
    '310260', '310270', '310310', '310490', '310580', '310660', '310800', '311490',
    '311580', '311660', '311870', '311880', '311882', '312250', '312530',
  ].map((c) => [c, TMOBILE])),
  ...Object.fromEntries([
    '310004', '310005', '310006', '310010', '310012', '310013', '311110', '311390',
    ...Array.from({ length: 20 }, (_, i) => String(311270 + i)),
    ...Array.from({ length: 10 }, (_, i) => String(311480 + i)),
  ].map((c) => [c, VERIZON])),
};

/**
 * Brand names, lower-cased, for when the code is missing or unknown. Only
 * brands that sit on a single network; Straight Talk, Tracfone, US Mobile and
 * Consumer Cellular sell SIMs on several and are deliberately absent.
 */
const BRANDS: readonly (readonly [RegExp, string])[] = [
  [/\bat&t\b|\batt\b|cricket|firstnet|h2o/, ATT],
  [/t-?mobile|\bmint\b|metro|google ?fi|\bfi\b|ultra mobile|uscellular|u\.s\. cellular/, TMOBILE],
  [/verizon|visible|xfinity|spectrum|total (wireless|by verizon)/, VERIZON],
];

export interface SimInfo {
  readonly mcc?: string | null;
  readonly mnc?: string | null;
  readonly name?: string | null;
}

/** The FCC provider id for a SIM, or null when it cannot be told honestly. */
export function carrierFromSim(sim: SimInfo): string | null {
  if (sim.mcc != null && sim.mnc != null) {
    // US network codes are three digits; a reader that drops a leading zero
    // ("4" for "004") still resolves.
    const hit = MCC_MNC[`${sim.mcc}${sim.mnc.padStart(3, '0')}`];
    if (hit !== undefined) return hit;
  }
  const name = sim.name?.trim().toLowerCase();
  if (name) {
    for (const [re, id] of BRANDS) if (re.test(name)) return id;
  }
  return null;
}
