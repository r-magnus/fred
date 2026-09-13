/**
 * BERT WordPiece tokenizer, shared by ingest and the device.
 *
 * This exists because two wrappers of the same engine tokenized and embedded
 * differently, and cosine was silently computed across two vector spaces
 * (docs/results-m3.md). Sharing the model file is not sufficient: tokenization
 * and pooling must be identical too, or the vectors still diverge. Implementing
 * both here, in portable TypeScript, makes parity structural rather than
 * something a runtime happens to get right.
 *
 * Mirrors HuggingFace's BertNormalizer + BertPreTokenizer + WordPiece +
 * TemplateProcessing, as configured by Supabase/gte-small:
 *   lowercase, clean_text, handle_chinese_chars, strip_accents,
 *   "##" continuation, max 100 chars/word, [CLS] … [SEP]
 */

export interface TokenizerConfig {
  readonly vocab: ReadonlyMap<string, number>;
  readonly unkId: number;
  readonly clsId: number;
  readonly sepId: number;
  readonly maxInputCharsPerWord: number;
}

export function buildVocab(vocabText: string): TokenizerConfig {
  const vocab = new Map<string, number>();
  const lines = vocabText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const token = lines[i];
    if (token === undefined || token === '') continue;
    vocab.set(token, i);
  }
  const need = (t: string): number => {
    const id = vocab.get(t);
    if (id === undefined) throw new Error(`vocab is missing ${t}`);
    return id;
  };
  return {
    vocab,
    unkId: need('[UNK]'),
    clsId: need('[CLS]'),
    sepId: need('[SEP]'),
    maxInputCharsPerWord: 100,
  };
}

/** BERT treats these CJK blocks as individual tokens, spaced apart. */
function isChinese(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** ASCII ranges BERT calls punctuation, plus anything Unicode marks as P*. */
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) ||
      (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}|\p{S}/u.test(ch) && !/\p{Sc}/u.test(ch) ? /\p{P}/u.test(ch) : /\p{P}/u.test(ch);
}

function isControl(ch: string): boolean {
  if (ch === '\t' || ch === '\n' || ch === '\r') return false;
  return /\p{Cc}|\p{Cf}/u.test(ch);
}

/**
 * clean_text, handle_chinese_chars, strip_accents, lowercase — in that order.
 * strip_accents is null in the config, which HuggingFace resolves to "follow
 * lowercase", so it is applied.
 */
export function normalize(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
    if (/\s/u.test(ch)) { out += ' '; continue; }
    out += isChinese(cp) ? ` ${ch} ` : ch;
  }
  return out
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '') // strip accents
    .toLowerCase();
}

/** Split on whitespace, then peel punctuation into its own tokens. */
export function preTokenize(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (chunk === '') continue;
    let cur = '';
    for (const ch of chunk) {
      if (isPunctuation(ch)) {
        if (cur !== '') { out.push(cur); cur = ''; }
        out.push(ch);
      } else {
        cur += ch;
      }
    }
    if (cur !== '') out.push(cur);
  }
  return out;
}

/** Greedy longest-match-first, with "##" marking continuations. */
export function wordPiece(word: string, cfg: TokenizerConfig): number[] {
  if ([...word].length > cfg.maxInputCharsPerWord) return [cfg.unkId];
  const chars = [...word];
  const ids: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let matched: number | null = null;
    while (start < end) {
      const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
      const id = cfg.vocab.get(piece);
      if (id !== undefined) { matched = id; break; }
      end--;
    }
    if (matched === null) return [cfg.unkId];
    ids.push(matched);
    start = end;
  }
  return ids;
}

/** Full pipeline, including the [CLS] … [SEP] wrapping the encoder expects. */
export function encode(text: string, cfg: TokenizerConfig, maxTokens = 512): number[] {
  const ids: number[] = [cfg.clsId];
  for (const word of preTokenize(normalize(text))) {
    for (const id of wordPiece(word, cfg)) {
      if (ids.length >= maxTokens - 1) break;
      ids.push(id);
    }
    if (ids.length >= maxTokens - 1) break;
  }
  ids.push(cfg.sepId);
  return ids;
}
