import { db, nowIso } from "./client.js";

type SettingRow = { key: string; value: string };

const selectAll = db.prepare("SELECT key, value FROM settings");
const upsert = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const remove = db.prepare("DELETE FROM settings WHERE key = :key");

export function readAllSettings(): Record<string, string> {
  const rows = selectAll.all() as SettingRow[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function writeSetting(key: string, value: string): void {
  upsert.run({ key, value, updated_at: nowIso() });
  process.env[key] = value;
}

export function deleteSetting(key: string): void {
  remove.run({ key });
  delete process.env[key];
}

/**
 * Overlay DB-stored values onto process.env. Call once at boot, after the DB is
 * initialized but before any connector code runs. DB overrides .env so that a
 * user editing the UI never has to think about which file holds what.
 */
export function loadSettingsIntoEnv(): void {
  const all = readAllSettings();
  for (const [k, v] of Object.entries(all)) {
    process.env[k] = v;
  }
}
