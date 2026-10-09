import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#5 custom slugs: valid, invalid, taken", async () => {
  const app = await start(); server = app.server;
  const ok = await post(app.base, "/links", { url: "https://one.example.com", slug: "my-launch" });
  expect(ok.status).toBe(201);
  expect((await ok.json()).slug).toBe("my-launch");
  expect((await post(app.base, "/links", { url: "https://x.example.com", slug: "A!" })).status).toBe(400);
  expect((await post(app.base, "/links", { url: "https://x.example.com", slug: "ab" })).status).toBe(400);
  expect((await post(app.base, "/links", { url: "https://two.example.com", slug: "my-launch" })).status).toBe(409);
  const hop = await fetch(`${app.base}/my-launch`, { redirect: "manual" });
  expect(hop.headers.get("location")).toBe("https://one.example.com");
  expect((await post(app.base, "/links", { url: "https://three.example.com" })).status).toBe(201);
});
