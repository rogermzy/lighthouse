import { Hono } from "hono";
import { db, nowIso } from "../db/client.js";

type ProfileRow = { name: string; email: string | null; initials: string | null };

const selectProfile = db.prepare("SELECT name, email, initials FROM user_profile WHERE id = 1");
const upsertProfile = db.prepare(`
  INSERT INTO user_profile (id, name, email, initials, updated_at)
  VALUES (1, :name, :email, :initials, :updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name       = excluded.name,
    email      = excluded.email,
    initials   = excluded.initials,
    updated_at = excluded.updated_at
`);

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

function row() {
  const r = (selectProfile.get() as ProfileRow | undefined) ?? { name: "You", email: null, initials: null };
  return { name: r.name, email: r.email ?? "", initials: r.initials || deriveInitials(r.name) };
}

export const profileApi = new Hono();

profileApi.get("/", (c) => c.json(row()));

profileApi.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name required" }, 400);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const explicitInitials = typeof body.initials === "string" ? body.initials.trim() : "";
  const initials = (explicitInitials || deriveInitials(name)).slice(0, 3).toUpperCase();

  upsertProfile.run({
    name,
    email: email || null,
    initials,
    updated_at: nowIso(),
  });

  return c.json(row());
});
