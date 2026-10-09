import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#6 expired links answer 410 and do not count", async () => {
  const app = await start(); server = app.server;
  const { slug } = await (await post(app.base, "/links", { url: "https://e.example.com", expiresInSeconds: 1 })).json();
  const keep = await (await post(app.base, "/links", { url: "https://k.example.com" })).json();
  expect((await fetch(`${app.base}/${slug}`, { redirect: "manual" })).status).toBe(302);
  await new Promise((r) => setTimeout(r, 1300));
  const gone = await fetch(`${app.base}/${slug}`, { redirect: "manual" });
  expect(gone.status).toBe(410);
  expect((await gone.json()).error).toBe("expired");
  expect((await (await fetch(`${app.base}/stats/${slug}`)).json()).clicks).toBe(1);
  expect((await fetch(`${app.base}/${keep.slug}`, { redirect: "manual" })).status).toBe(302);
}, 10000);
