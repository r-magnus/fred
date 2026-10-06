/** The opener's raw model line, before the check (for opener-probe.ts). */
import type { InferenceBackend } from '@fred/rag-core';
import { OPENER_SYSTEM, openerUser } from '@fred/rag-core';

export async function makeOpenerRaw(message: string, history: readonly string[], backend: InferenceBackend): Promise<string> {
  let out = '';
  for await (const tok of backend.generate({ system: OPENER_SYSTEM, user: openerUser(message, history) }, { maxTokens: 30, temperature: 0, stop: ['\n', '.', '!'], lane: 'opener' })) out += tok;
  return out.trim();
}
