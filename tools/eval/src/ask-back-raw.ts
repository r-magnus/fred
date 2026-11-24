/** #286: the model's raw question-back output for a few messages, one per line of a file. */
import { readFileSync } from 'node:fs';
import { ASK_BACK_SYSTEM, topicsOf } from '@fred/rag-core';
import { openHarness } from './harness.ts';
const harness = await openHarness();
const lines = readFileSync(process.argv[2]!, 'utf8').split('\n').filter((l) => l.trim() !== '');
for (const l of lines) {
  const [message, topics] = l.split('\t');
  const user = `Hiker: "${message}" GUIDE TOPICS: ${topicsOf(topics!.split(';')).join('; ')} ->`;
  let out = '';
  for await (const t of harness.backend.generate({ system: ASK_BACK_SYSTEM, user }, { maxTokens: 70, temperature: 0, stop: ['\n'] })) out += t;
  console.log(`${message}\n   RAW: ${JSON.stringify(out)}`);
}
harness.close?.();
