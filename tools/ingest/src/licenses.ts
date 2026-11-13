/**
 * License entries for every source a pack can draw on. Shared so a derived
 * pack (field cards) carries exactly the terms of what it was written from.
 */
import type { LicenseEntry } from '@fred/pack-format';

export const WHO_BEC_LICENSE: LicenseEntry = {
  id: 'who-bec',
  license: 'CC-BY-NC-SA-3.0-IGO',
  sourceTitle: 'WHO/ICRC Basic Emergency Care: approach to the acutely ill and injured',
  sourceUrl: 'https://www.who.int/publications-detail-redirect/basic-emergency-care-approach-to-the-acutely-ill-and-injured',
  attribution: 'WHO/ICRC Basic Emergency Care (2018), CC BY-NC-SA 3.0 IGO',
  nonCommercial: true,
};

export const ATP_SURVIVAL_LICENSE: LicenseEntry = {
  id: 'atp-3-50-21',
  license: 'Public domain (US Government work)',
  sourceTitle: 'ATP 3-50.21, Survival (Headquarters, Department of the Army, September 2018)',
  sourceUrl: 'https://archive.org/details/survival-atp-3-50-21',
  attribution: 'US Army ATP 3-50.21, Survival (2018). Approved for public release; distribution is unlimited.',
  nonCommercial: false,
};

/**
 * A WHO-free source for a commercial build (#214). Written for merchant crews
 * far from a doctor; the 2003 edition keeps examination, fluids, heat and cold,
 * wound care, dental care and cold-water immersion, and leaves acute trauma to
 * other texts, so only those chapters are used.
 */
export const USPHS_SHIPS_LICENSE: LicenseEntry = {
  id: 'usphs-ships',
  license: 'Public domain (US Government work)',
  sourceTitle: "The Ship's Medicine Chest and Medical Aid at Sea, 2003 Edition (US Department of Health and Human Services, Public Health Service, DHHS Publication No. (PHS) 03-2024)",
  sourceUrl: 'https://www.govinfo.gov/app/details/GOVPUB-HE20-PURL-gpo20582',
  attribution: "US Public Health Service, The Ship's Medicine Chest and Medical Aid at Sea (2003).",
  nonCommercial: false,
};

export const ATP_FIRST_AID_LICENSE: LicenseEntry = {
  id: 'atp-4-02-11',
  license: 'Public domain (US Government work)',
  sourceTitle: 'ATP 4-02.11, Casualty Response, Tactical Combat Casualty Care, and First Aid (Headquarters, Department of the Army, March 2026)',
  sourceUrl: 'https://archive.org/details/army-techniques-publication-for-casualty-response-tactical-combat-casualty-care-',
  attribution: 'US Army ATP 4-02.11, Casualty Response, Tactical Combat Casualty Care, and First Aid (2026). Approved for public release; distribution is unlimited.',
  nonCommercial: false,
};


/**
 * Only the signalling chapter is used. ATP 3-50.21 (2018) dropped signalling
 * (it moved to recovery doctrine), and FM 3-05.70 (2002), which kept it, is
 * distribution-restricted to US Government agencies and contractors, so it
 * cannot ship. FM 21-76 (1992) is approved for public release.
 */
export const FM_21_76_LICENSE: LicenseEntry = {
  id: 'fm-21-76',
  license: 'Public domain (US Government work)',
  sourceTitle: 'FM 21-76, Survival (Headquarters, Department of the Army, June 1992), Chapter 19 Signaling Techniques',
  sourceUrl: 'https://www.bits.de/NRANEU/others/amd-us-archive/FM21-76(92).pdf',
  attribution: 'US Army FM 21-76, Survival (1992). Approved for public release; distribution is unlimited.',
  nonCommercial: false,
};
