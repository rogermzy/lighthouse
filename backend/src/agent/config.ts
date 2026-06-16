/** Shared knobs for all Claude agents in this repo. Centralized so a model
 *  bump or env-key rename is a one-file change instead of four. */

export const MODEL = "claude-opus-4-7";

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
