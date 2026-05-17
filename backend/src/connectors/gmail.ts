import { google } from "googleapis";
import type { Connector, InboxItemWire } from "./types.js";
import { googleOAuthClient, isGoogleOAuthConfigured, hasGoogleTokens } from "../auth/oauth.js";
import { upsertInboxItems } from "../sync/reconcile.js";

// Only messages bearing this label are pulled. Explicit labeling beats
// star-based heuristics because starring is overloaded (reference, follow-up,
// read-later) while a dedicated label is unambiguous intent: "send to Lighthouse".
const LABEL = process.env.GMAIL_TRIAGE_LABEL ?? "Lighthouse";

export const gmailConnector: Connector = {
  name: "gmail",
  intervalMs: 2 * 60 * 1000,

  async isEnabled() {
    return isGoogleOAuthConfigured() && hasGoogleTokens();
  },

  async sync() {
    const auth = googleOAuthClient();
    const gmail = google.gmail({ version: "v1", auth });

    const query = `label:${LABEL}`;

    // Paginate the full set so we don't silently drop messages past 100.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const list = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 100,
        pageToken,
      });
      for (const m of list.data.messages ?? []) {
        if (m.id) ids.push(m.id);
      }
      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (ids.length === 0) {
      // Empty pull still goes through reconcile so de-labelled items get pruned.
      upsertInboxItems("email", []);
      return;
    }

    const metas = await Promise.all(
      ids.map((id) =>
        gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From"],
        })
      )
    );

    const items: InboxItemWire[] = metas.map((res) => {
      const headers = res.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      return {
        externalId: res.data.id!,
        source: "email",
        title: subject,
      };
    });

    upsertInboxItems("email", items);
  },
};
