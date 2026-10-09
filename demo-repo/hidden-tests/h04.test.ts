import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#4 HEAD redirects without counting a click", async () => {
  const app = await start(); server = app.server;
  const { slug } = await (await post(app.base, "/links", { url: "https://example.com" })).json();
  const head = await fetch(`${app.base}/${slug}`, { method: "HEAD", redirect: "manual" });
  expect(head.status).toBe(302);
  expect(head.headers.get("location")).toBe("https://example.com");
  await fetch(`${app.base}/${slug}`, { redirect: "manual" });
  expect((await (await fetch(`${app.base}/stats/${slug}`)).json()).clicks).toBe(1);
});
