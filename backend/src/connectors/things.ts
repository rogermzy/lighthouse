import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Connector, UnifiedTask } from "./types.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

const execFileAsync = promisify(execFile);

const FIELD_DELIM = "\x1f"; // ASCII unit separator
const RECORD_DELIM = "\x1e"; // ASCII record separator

// Things 3 has no cloud API. We shell out to osascript for open to-dos.
// ASCII 31/30 separators handle arbitrary characters in task names safely.
const SCRIPT = `
tell application "Things3"
  set delim_field to ASCII character 31
  set delim_record to ASCII character 30
  set output to ""
  set theTodos to to dos whose status is open
  repeat with t in theTodos
    set this_id to id of t
    set this_name to name of t
    try
      set this_notes to notes of t
    on error
      set this_notes to ""
    end try
    try
      set this_area to name of area of t
    on error
      try
        set this_area to name of project of t
      on error
        set this_area to ""
      end try
    end try
    set output to output & this_id & delim_field & this_name & delim_field & this_notes & delim_field & this_area & delim_record
  end repeat
  return output
end tell
`;

async function thingsInstalled(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'application "Things3" exists',
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export const thingsConnector: Connector = {
  name: "things",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return thingsInstalled();
  },

  async sync() {
    const { stdout } = await execFileAsync("osascript", ["-e", SCRIPT], {
      maxBuffer: 5 * 1024 * 1024,
    });

    const records = stdout.split(RECORD_DELIM).map((r) => r.trim()).filter(Boolean);
    const tasks: UnifiedTask[] = records.map((record) => {
      const [externalId, title, notes, area] = record.split(FIELD_DELIM);
      return {
        externalId: externalId ?? "",
        title: title || "(untitled)",
        note: notes?.trim() || undefined,
        project: area?.trim() || undefined,
        // Things URL scheme — opens the to-do directly in the Mac app.
        url: externalId ? `things:///show?id=${externalId}` : undefined,
      };
    }).filter((t) => t.externalId);

    upsertTasksFromSource("things", tasks);
  },

  // AppleScript flips the to-do's status. Things3 accepts "completed" /
  // "open" as the two interesting transitions. ID is escaped for AppleScript
  // quoting — Things ids are UUID-like (alphanumerics + hyphens), so a
  // simple regex check is sufficient defence against script injection.
  async setDone(externalId: string, done: boolean) {
    if (process.platform !== "darwin") {
      throw new Error("Things connector only supports macOS");
    }
    if (!/^[A-Za-z0-9-]+$/.test(externalId)) {
      throw new Error(`Things setDone: refusing unsafe id "${externalId}"`);
    }
    const status = done ? "completed" : "open";
    const script = `tell application "Things3" to set status of to do id "${externalId}" to ${status}`;
    await execFileAsync("osascript", ["-e", script]);
  },
};
