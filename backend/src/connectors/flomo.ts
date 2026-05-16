/**
 * Flomo two-way sync — pull side.
 *
 * Flomo's official public API is write-only (the incoming webhook for
 * creating memos). For pulling, we use the private RSS feed that PRO
 * users can enable in flomo's settings. Each memo becomes a journal
 * entry, deduped by the RSS guid.
 *
 * Circular-sync guard: memos containing the `#lighthouse` tag are skipped
 * on pull — those originated here and got pushed via the webhook. Without
 * this, every push would echo back next sync and we'd accumulate dupes
 * forever.
 */
import type { Connector } from "./types.js";
import { db, nowIso } from "../db/client.js";

const insertOrIgnoreMemo = db.prepare(`
  INSERT OR IGNORE INTO journal_entries (id, mood, note, source, external_id, created_at)
  VALUES (:id, :mood, :note, 'flomo', :external_id, :created_at)
`);

const LIGHTHOUSE_TAG = /#lighthouse\b/i;

type FlomoMemo = {
  guid: string;
  content: string;
  createdAt: string; // ISO
};

/**
 * Tiny RSS parser — pulls <item><title>, <description>/<content:encoded>,
 * <guid>, <pubDate> out of the feed. Flomo's RSS puts the memo body in
 * <description> (HTML); we strip tags. Avoids a deps add for ~30 lines of
 * regex work that's sufficient for this single feed shape.
 */
function parseFlomoRss(xml: string): FlomoMemo[] {
  const items: FlomoMemo[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const guid = pick(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i)
      ?? pick(block, /<link>([\s\S]*?)<\/link>/i)
      ?? "";
    const rawBody = pick(block, /<content:encoded[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
      ?? pick(block, /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i)
      ?? pick(block, /<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)
      ?? pick(block, /<description[^>]*>([\s\S]*?)<\/description>/i)
      ?? "";
    const pubDate = pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/i) ?? "";
    if (!guid || !rawBody) continue;
    const content = stripHtml(rawBody).trim();
    if (!content) continue;
    items.push({
      guid: guid.trim(),
      content,
      createdAt: pubDate ? new Date(pubDate).toISOString() : nowIso(),
    });
  }
  return items;
}

function pick(s: string, re: RegExp): string | undefined {
  const m = re.exec(s);
  return m ? decodeEntities(m[1]) : undefined;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Heuristic mood detection — if the memo contains a known #mood tag, use it.
// Otherwise fall back to "focused" (the only mood that doesn't imply a
// specific feeling, so it's a safe default for unannotated content).
const KNOWN_MOODS = ["calm", "focused", "scattered", "drained", "buzzy", "low"];
function detectMood(content: string): string {
  for (const m of KNOWN_MOODS) {
    if (new RegExp(`#${m}\\b`, "i").test(content)) return m;
  }
  return "focused";
}

export const flomoConnector: Connector = {
  name: "flomo",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return Boolean(process.env.FLOMO_RSS_URL);
  },

  async sync() {
    const url = process.env.FLOMO_RSS_URL!;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Flomo RSS ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    const memos = parseFlomoRss(xml);

    let imported = 0;
    for (const memo of memos) {
      // Skip memos that originated from Lighthouse (we pushed them via the
      // webhook earlier). They carry the #lighthouse tag for exactly this.
      if (LIGHTHOUSE_TAG.test(memo.content)) continue;

      const id = `flomo-${memo.guid.replace(/[^a-zA-Z0-9-]/g, "").slice(-20)}-${Date.now().toString(36).slice(-4)}`;
      const result = insertOrIgnoreMemo.run({
        id,
        mood: detectMood(memo.content),
        note: memo.content,
        external_id: memo.guid,
        created_at: memo.createdAt,
      });
      if (result.changes > 0) imported++;
    }
    if (imported > 0) console.log(`[flomo] imported ${imported} new memo(s)`);
  },
};
