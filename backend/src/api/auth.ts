import { Hono } from "hono";
import { getApiToken, generateApiToken, revokeApiToken } from "../auth/api-token.js";

export const authTokenApi = new Hono();

authTokenApi.get("/token", (c) => {
  const token = getApiToken();
  return c.json({ token, hasToken: token !== null });
});

authTokenApi.post("/token", (c) => {
  const token = generateApiToken();
  return c.json({ token, hasToken: true });
});

authTokenApi.delete("/token", (c) => {
  revokeApiToken();
  return c.json({ token: null, hasToken: false });
});
