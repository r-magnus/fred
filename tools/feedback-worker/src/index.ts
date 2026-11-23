/**
 * Fred's feedback server (#247): a Cloudflare Worker that takes one rating per
 * POST from the app and keeps it in D1. Nothing is ever served back: the
 * ratings are read with wrangler (README.md), not over this address.
 *
 *   POST /feedback   200 kept · 400 refused (the app lets it go)
 *                    413 too big · 429 too many (the app tries later)
 *   POST /usage      the same answers, for a batch of usage counts (#285)
 */
import { MAX_BODY, UPSERT, bindings, check } from './check.ts';
import { USAGE_INSERT, USAGE_MAX_BODY, checkUsage, usageBindings } from './usage.ts';

/** Just the parts of the Workers types used here, so no type package is needed. */
interface D1Statement { run(): Promise<unknown> }
interface D1 {
  prepare(sql: string): { bind(...v: unknown[]): D1Statement };
  batch(statements: D1Statement[]): Promise<unknown>;
}
interface Limiter { limit(o: { key: string }): Promise<{ success: boolean }> }
interface Env { DB: D1; LIMITER?: Limiter }

const CLIENT = /^fred-app\/\d+$/;
const reply = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const usage = url.pathname === '/usage';
    if (url.pathname !== '/feedback' && !usage) return reply(404, 'not found');
    if (req.method !== 'POST') return reply(405, 'POST only');
    // Not a secret; it only keeps stray traffic out.
    if (!CLIENT.test(req.headers.get('X-Fred-Client') ?? '')) return reply(403, 'unknown client');

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.LIMITER !== undefined && !(await env.LIMITER.limit({ key: ip })).success) return reply(429, 'slow down');

    const text = await req.text();
    if (text.length > (usage ? USAGE_MAX_BODY : MAX_BODY)) return reply(413, 'too big');
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply(400, 'not JSON'); }

    if (usage) {
      const u = checkUsage(body);
      if (!u.ok) return reply(400, `refused: ${u.why}`);
      const at = new Date().toISOString();
      const stmt = env.DB.prepare(USAGE_INSERT);
      await env.DB.batch(u.rows.map((r) => stmt.bind(...usageBindings(r, at))));
      return reply(200, 'kept');
    }
    const res = check(body);
    if (!res.ok) return reply(400, `refused: ${res.why}`);

    await env.DB.prepare(UPSERT).bind(...bindings(res.row, new Date().toISOString())).run();
    return reply(200, 'kept');
  },
};
