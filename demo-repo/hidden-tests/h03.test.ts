import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#3 stats for an unknown slug is 404", async () => {
  const app = await start(); server = app.server;
  const r = await fetch(`${app.base}/stats/nope42`);
  expect(r.status).toBe(404);
  expect((await r.json()).error).toBe("not found");
});
