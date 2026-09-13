/**
 * Ablation harness: runs each condition over an eval set and reports accuracy,
 * latency and prompt size.
 *
 *   node tools/eval/src/run.ts [dataset.json ...]
 *
 * Answers are produced under a GBNF grammar restricting output to a single
 * letter. A 0.6B model asked politely for "just the letter" does not reliably
 * comply, and every parse failure would otherwise be silently scored as wrong,
 * inflating the apparent benefit of retrieval.
 */
import { writeFileSync } from 'node:fs';
import { getLlama, LlamaCompletion, type LlamaGrammar, type LlamaModel, type LlamaContext } from 'node-llama-cpp';
import {
  compressContext, extractKeywords, retrieve, route,
  DEFAULT_COMPRESSION, DEFAULT_RETRIEVAL, DEFAULT_ABSTAIN_THRESHOLD,
  SYSTEM_PREFIX, renderContext, type ScoredChunk,
} from '@fred/rag-core';
import { NodePackStore } from './node-pack.ts';
import { loadDataset, answerBalance } from './dataset.ts';
import { CONDITIONS, type ConditionId, type ConditionSummary, type EvalQuestion, type QuestionResult } from './types.ts';

const PACK_DIR = 'packs/core-firstaid-v1.0.0';
const GEN_MODEL = `${process.env.HOME}/models/Qwen3-0.6B-Q4_K_M.gguf`;
const EMBED_MODEL = `${process.env.HOME}/models/gte-small_fp16.gguf`;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

function renderQuestion(q: EvalQuestion): string {
  const opts = q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('\n');
  return `${q.question}\n${opts}`;
}

/**
 * Raw completion prompt — deliberately NOT a chat template.
 *
 * Scoring through LlamaChatSession produced exactly 26.1% in every condition,
 * which is chance. Qwen3's chat template opens the assistant turn with a <think>
 * block, so a `root ::= [ABCD]` grammar constrains a position whose distribution
 * concerns reasoning tokens, not answer letters; masking there collapsed to "A"
 * on 46 of 46 questions in all four arms. Raw completion has no template, so the
 * prompt ends at "Answer:" and the next token is genuinely the answer.
 *
 * Worth flagging in the writeup: evaluating a reasoning model through a chat
 * template with constrained decoding yields a silent, plausible null result.
 */
function buildPrompt(q: EvalQuestion, context: string | null): string {
  const body = `Question: ${renderQuestion(q)}`;
  if (context === null) {
    return `${body}\nAnswer:`;
  }
  return `${SYSTEM_PREFIX}\n\nSOURCES:\n${context}\n\nUse the sources above to answer.\n\n${body}\nAnswer:`;
}

async function main(): Promise<void> {
  const datasets = process.argv.slice(2);
  if (datasets.length === 0) datasets.push('tools/eval/data/bec-corpus.json');

  const questions = datasets.flatMap((d) => loadDataset(d));
  console.log(`loaded ${questions.length} questions from ${datasets.length} file(s)`);
  console.log(`answer balance A/B/C/D: ${answerBalance(questions).join('/')}\n`);

  const store = new NodePackStore();
  const manifest = store.load(PACK_DIR);
  const packs = [{ id: manifest.id, domains: manifest.domains, scope: manifest.scope }];

  const llama = await getLlama();
  const embedModel: LlamaModel = await llama.loadModel({ modelPath: EMBED_MODEL });
  const embedCtx = await embedModel.createEmbeddingContext();
  const genModel: LlamaModel = await llama.loadModel({ modelPath: GEN_MODEL });
  const genCtx: LlamaContext = await genModel.createContext({ contextSize: 4096 });
  const grammar: LlamaGrammar = await llama.createGrammar({ grammar: 'root ::= [ABCD]' });

  const backend = {
    embeddingSpec: () => manifest.embedding,
    embed: async (t: string) => Float32Array.from((await embedCtx.getEmbeddingFor(t)).vector),
    countTokens: async (texts: readonly string[]): Promise<number[]> => texts.map((t) => genModel.tokenize(t).length),
    // eslint-disable-next-line require-yield
    async *generate(): AsyncIterable<string> { throw new Error('unused in MCQ scoring'); },
  };

  const results: QuestionResult[] = [];

  for (const condition of CONDITIONS) {
    process.stdout.write(`${condition}: `);
    for (const q of questions) {
      let context: string | null = null;
      let hits: ScoredChunk[] = [];

      if (condition !== 'vanilla') {
        const kws = extractKeywords(q.question);
        const routed = route(kws, packs, { state: null });
        hits = await retrieve(kws, routed.packIds, store, backend, {
          ...DEFAULT_RETRIEVAL,
          mode: condition === 'rag' ? 'lexical-only' : 'hybrid',
        });
        if (hits.length > 0) {
          const blocks = condition === 'rag-rerank-compress'
            ? (await compressContext(hits.map((h) => h.chunk), kws, {
                ...DEFAULT_COMPRESSION,
                countTokens: (texts) => backend.countTokens(texts),
              })).chunks
            : hits.map((h) => ({ chunk: h.chunk, text: h.chunk.text }));
          context = renderContext(blocks);
        }
      }

      const prompt = buildPrompt(q, context);
      // Acquire and release a sequence per question. A context owns a fixed pool,
      // and each question must start from a clean KV state anyway so that no
      // answer can leak into the next one.
      const sequence = genCtx.getSequence();
      let raw: string;
      let latencyMs: number;
      try {
        const completion = new LlamaCompletion({ contextSequence: sequence });
        const t0 = Date.now();
        raw = await completion.generateCompletion(prompt, { grammar, maxTokens: 3 });
        latencyMs = Date.now() - t0;
      } finally {
        sequence.dispose();
      }
      const chosen = LETTERS.indexOf(raw.trim().toUpperCase()[0] as 'A');
      const topScore = hits[0]?.score ?? 0;

      results.push({
        questionId: q.id,
        condition,
        chosen,
        correct: chosen === q.answer,
        latencyMs,
        promptTokens: (await backend.countTokens([prompt]))[0] ?? 0,
        topScore,
        wouldAbstain: condition !== 'vanilla' && topScore < DEFAULT_ABSTAIN_THRESHOLD,
        retrievedPages: hits.map((h) => h.chunk.page ?? -1),
      });
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  }

  const summaries: ConditionSummary[] = CONDITIONS.map((condition) => {
    const rows = results.filter((r) => r.condition === condition);
    const answered = rows.filter((r) => !r.wouldAbstain);
    const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    return {
      condition,
      n: rows.length,
      accuracy: mean(rows.map((r) => (r.correct ? 1 : 0))),
      meanLatencyMs: mean(rows.map((r) => r.latencyMs)),
      meanPromptTokens: mean(rows.map((r) => r.promptTokens)),
      abstainRate: mean(rows.map((r) => (r.wouldAbstain ? 1 : 0))),
      accuracyWhenAnswering: mean(answered.map((r) => (r.correct ? 1 : 0))),
    };
  });

  console.log('\n| condition | n | accuracy | mean ms | prompt tok | abstain | acc when answering |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const s of summaries) {
    console.log(
      `| ${s.condition} | ${s.n} | ${(s.accuracy * 100).toFixed(1)}% | ${s.meanLatencyMs.toFixed(0)} | ` +
      `${s.meanPromptTokens.toFixed(0)} | ${(s.abstainRate * 100).toFixed(0)}% | ${(s.accuracyWhenAnswering * 100).toFixed(1)}% |`,
    );
  }

  writeFileSync('docs/eval-results.json', JSON.stringify({ summaries, results }, null, 2));
  console.log('\nwrote docs/eval-results.json');

  await embedCtx.dispose();
  await embedModel.dispose();
  await genCtx.dispose();
  await genModel.dispose();
  store.close();
}

await main();
