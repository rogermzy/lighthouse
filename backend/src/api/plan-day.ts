import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { isAgentConfigured, runPlanDayAgent } from "../agent/plan-day.js";

export const planDayApi = new Hono();

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
    if (err instanceof Anthropic.RateLimitError) {
      return c.json({ error: "rate limited", detail: err.message }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      return c.json({ error: "anthropic api error", status: err.status, detail: err.message }, 502);
    }
    const message = err instanceof Error ? err.message : String(err);
    // Client-aborted (modal closed mid-run): the socket may already be
    // dead, but return a typed body so logs don't read this as a real
    // failure. Hono's ContentfulStatusCode union doesn't include the
    // (non-standard) 499 we'd prefer, so cast — the code is mainly for
    // log clarity since the response usually doesn't reach the client.
    if (message === "aborted" || c.req.raw.signal?.aborted) {
      return c.json({ error: "aborted" }, 499 as unknown as 500);
    }
    return c.json({ error: "agent failed", detail: message }, 500);
  }
});
