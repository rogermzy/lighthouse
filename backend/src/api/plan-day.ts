import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { isAgentConfigured, runPlanDayAgent } from "../agent/plan-day.js";
import { AgentLoopError } from "../agent/loop.js";

export const planDayApi = new Hono();

// Hono's c.json types reject non-standard status codes like 499 ("Client
// Closed Request" — non-standard but the common log convention for aborts).
// Bypass the typed helper with a plain Response so the status code is
// truthful in logs without resorting to a `499 as unknown as 500` cast.
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

planDayApi.post("/", async (c) => {
  if (!isAgentConfigured()) {
    return c.json({ error: "ANTHROPIC_API_KEY not set" }, 503);
  }
  try {
    // Pipe the request's abort signal through so a client disconnect (modal
    // closed, page navigated) cancels the in-flight Anthropic call instead
    // of letting it run to completion and discard the result.
    const picks = await runPlanDayAgent(c.req.raw.signal);
    return c.json({ picks });
  } catch (err) {
    // APIUserAbortError extends APIError — it MUST be checked before the
    // generic APIError branch or aborts get mis-reported as 502s. The
    // pre-call signal check in loop.ts produces an AgentLoopError("aborted")
    // for the case the signal fires between iterations.
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
      // Surface the typed code so the modal can show a useful message.
      return c.json({ error: err.code, detail: err.message }, 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "agent failed", detail: message }, 500);
  }
});
