import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/client.js";

const SETTING_KEY = "LIGHTHOUSE_API_TOKEN";

const select = db.prepare("SELECT value FROM settings WHERE key = :key");
const upsert = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const remove = db.prepare("DELETE FROM settings WHERE key = :key");

export function getApiToken(): string | null {
  const row = select.get({ key: SETTING_KEY }) as { value: string } | undefined;
  return row?.value ?? null;
}

export function generateApiToken(): string {
  // 24 bytes = 48 hex chars; `lhk_` prefix makes it grep-able in logs/configs.
  const token = `lhk_${randomBytes(24).toString("hex")}`;
  upsert.run({ key: SETTING_KEY, value: token, updated_at: nowIso() });
  return token;
}

export function revokeApiToken(): void {
  remove.run({ key: SETTING_KEY });
}

/**
 * Constant-time check of the Authorization header against the stored token.
 * Returns false if no header, malformed header, no stored token, or mismatch.
 */
export function checkBearer(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const stored = getApiToken();
  if (!stored) return false;
  const m = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  const provided = m[1]!;
  if (provided.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
  } catch {
    return false;
  }
}
