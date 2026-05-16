import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { isAgentConfigured, runSuggestAgent } from "../agent/suggest.js";

export const suggestApi = new Hono();

suggestApi.post("/", async (c) => {
  if (!isAgentConfigured()) {
    return c.json({ error: "ANTHROPIC_API_KEY not set" }, 503);
  }
  try {
    const suggestions = await runSuggestAgent();
    return c.json({ suggestions });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return c.json({ error: "rate limited", detail: err.message }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      return c.json({ error: "anthropic api error", status: err.status, detail: err.message }, 502);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "agent failed", detail: message }, 500);
  }
});
