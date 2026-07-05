import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lives next to the SQLite file — gitignored. chmod 0600 on every write.
const TOKEN_FILE = process.env.LIGHTHOUSE_TOKENS ?? join(__dirname, "..", "..", ".tokens.json");

type AllTokens = Record<string, Record<string, unknown>>;

function readAll(): AllTokens {
  if (!existsSync(TOKEN_FILE)) return {};
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as AllTokens;
  } catch (err) {
    console.warn(`[tokens] couldn't parse ${TOKEN_FILE} — treating as empty:`, String(err));
    return {};
  }
}

export function readTokens(provider: string): Record<string, unknown> | null {
  const all = readAll();
  return all[provider] ?? null;
}

// tmp + rename: atomic replace, and the file is 0600 from birth instead of
// existing world-readable for the instant before a post-hoc chmod.
function writeAll(all: AllTokens): void {
  const tmp = `${TOKEN_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600); // mode option is ignored if tmp already existed
  } catch {
    // Non-fatal on filesystems that don't support chmod (e.g. Windows).
  }
  renameSync(tmp, TOKEN_FILE);
}

export function writeTokens(provider: string, tokens: Record<string, unknown>): void {
  const all = readAll();
  all[provider] = tokens;
  writeAll(all);
}

export function hasTokens(provider: string): boolean {
  const t = readTokens(provider);
  return t !== null && (typeof t.refresh_token === "string" || typeof t.access_token === "string");
}

export function deleteTokens(provider: string): void {
  const all = readAll();
  delete all[provider];
  writeAll(all);
}
