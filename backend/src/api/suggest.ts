import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { isAgentConfigured, runSuggestAgent } from "../agent/suggest.js";
import { AgentLoopError } from "../agent/loop.js";

export const suggestApi = new Hono();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

suggestApi.post("/", async (c) => {
  if (!isAgentConfigured()) {
    return c.json({ error: "ANTHROPIC_API_KEY not set" }, 503);
  }
  try {
    // Pipe abort signal through so closing SuggestionModal mid-run cancels
    // the in-flight Anthropic call instead of burning the full 16k × 8
    // budget for a result no one will read.
    const suggestions = await runSuggestAgent(c.req.raw.signal);
    return c.json({ suggestions });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      return jsonResponse({ error: "aborted" }, 499);
    }
    if (err instanceof AgentLoopError && err.code === "aborted") {
      return jsonResponse({ error: "aborted" }, 499);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return c.json({ error: "rate limited", detail: err.message }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      return c.json({ error: "anthropic api error", status: err.status, detail: err.message }, 502);
    }
    if (err instanceof AgentLoopError) {
      return c.json({ error: err.code, detail: err.message }, 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "agent failed", detail: message }, 500);
  }
});
