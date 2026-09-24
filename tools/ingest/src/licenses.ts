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

export const ATP_FIRST_AID_LICENSE: LicenseEntry = {
  id: 'atp-4-02-11',
  license: 'Public domain (US Government work)',
  sourceTitle: 'ATP 4-02.11, Casualty Response, Tactical Combat Casualty Care, and First Aid (Headquarters, Department of the Army, March 2026)',
  sourceUrl: 'https://archive.org/details/army-techniques-publication-for-casualty-response-tactical-combat-casualty-care-',
  attribution: 'US Army ATP 4-02.11, Casualty Response, Tactical Combat Casualty Care, and First Aid (2026). Approved for public release; distribution is unlimited.',
  nonCommercial: false,
};

