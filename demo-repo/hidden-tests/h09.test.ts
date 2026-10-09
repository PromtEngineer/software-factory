import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#9 the 11th create in a minute is 429 with retry-after; redirects are not limited", async () => {
  const app = await start(); server = app.server;
  let slug = "";
  for (let i = 0; i < 10; i++) {
    const r = await post(app.base, "/links", { url: `https://r${i}.example.com` });
    expect(r.status).toBe(201); slug = (await r.json()).slug;
  }
  const limited = await post(app.base, "/links", { url: "https://r10.example.com" });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  for (let i = 0; i < 15; i++) expect((await fetch(`${app.base}/${slug}`, { redirect: "manual" })).status).toBe(302);
});
