/**
 * What first-run setup (#196) keeps on the phone and reads from it: whether
 * setup has been finished, whether the guides are here, which states are.
 *
 * "Finished" is a file, setup.json, beside the packs. It is written when the
 * hiker reaches the end of the wizard or skips out of it, so the wizard is
 * shown once and never again unless asked for from the guide.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { PackManifest } from '@fred/pack-format';
import { embedderFilesFor } from './device-pack.ts';
import { MODEL_FILE } from './engine.ts';
import { detailOnPhone } from './map-files.ts';
import { splitKey } from './regions.ts';

const done = (): File => new File(Paths.document, 'setup.json');
const hook = (name: string): boolean => new File(Paths.document, name).exists;

/**
 * Whether to open on the wizard.
 *
 * Never during a phone test run: those drive the chat from the desktop with
 * the screen locked (the `devhooks` file, App.tsx), and a wizard in the way
 * would stall every question. A `devhooks-setup` file beside it asks for the
 * wizard anyway, to look at it on a phone that is already set up.
 */
export function wizardWanted(): boolean {
  if (hook('devhooks')) return hook('devhooks-setup');
  return !done().exists;
}

export function markSetupDone(): void {
  try {
    done().write(JSON.stringify({ finishedAt: new Date().toISOString() }));
    // Asked for once, shown once.
    const again = new File(Paths.document, 'devhooks-setup');
    if (again.exists) again.delete();
  } catch { /* shown again next time, which is the safe way to fail */ }
}

/**
 * The beta notice (#248): the version of its words the hiker agreed to, and
 * when. Raise AGREEMENT_VERSION when the words change in substance, and
 * everyone is asked again on their next open.
 */
export const AGREEMENT_VERSION = 1;
const agreement = (): File => new File(Paths.document, 'agreement.json');

/** Whether to ask for the agreement before the chat: not yet given, or given to older words. */
export function agreementWanted(): boolean {
  // Phone test runs drive the chat with the screen locked; nothing may stand in their way.
  if (hook('devhooks')) return false;
  try {
    const f = agreement();
    if (!f.exists) return true;
    const saved = JSON.parse(f.textSync()) as { version?: unknown };
    return typeof saved.version !== 'number' || saved.version < AGREEMENT_VERSION;
  } catch {
    return true;
  }
}

export function markAgreed(): void {
  try {
    agreement().write(JSON.stringify({ version: AGREEMENT_VERSION, agreedAt: new Date().toISOString() }));
  } catch { /* asked again next time, which is the safe way to fail */ }
}

/**
 * Whether Fred can answer here: the model that writes, the model that
 * searches, and at least one guide that is the same everywhere. The same
 * things the engine needs at load (src/engine.ts), checked without loading
 * them.
 */
export function guidesOnPhone(): boolean {
  try {
    if (!new File(Paths.document, MODEL_FILE).exists) return false;
    const packs = new Directory(Paths.document, 'packs');
    if (!packs.exists) return false;
    const core = packs.list().find((d) => d instanceof Directory && d.name.startsWith('core-'));
    if (core === undefined) return false;
    const manifest = JSON.parse(new File(core as Directory, 'manifest.json').textSync()) as PackManifest;
    return new File(Paths.document, embedderFilesFor(manifest.embedding.modelId).model).exists;
  } catch {
    return false;
  }
}

/**
 * States with a map on the phone, by USPS code: a whole state, or any region
 * of a split one (#224). The nationwide overview alone does not count.
 */
export function statesOnPhone(): string[] {
  return [...new Set([...detailOnPhone()].map((k) => splitKey(k).state))].sort();
}
