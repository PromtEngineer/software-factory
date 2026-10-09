import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#1 a colliding random slug never overwrites an existing link", async () => {
  const seq = ["dupdup", "dupdup", "fresh1", "fresh2"]; let i = 0;
  const app = await start({ slugFn: () => seq[Math.min(i++, seq.length - 1)] }); server = app.server;
  const a = await (await post(app.base, "/links", { url: "https://a.example.com" })).json();
  const b = await (await post(app.base, "/links", { url: "https://b.example.com" })).json();
  expect(a.slug).not.toBe(b.slug);
  const hop = await fetch(`${app.base}/${a.slug}`, { redirect: "manual" });
  expect(hop.headers.get("location")).toBe("https://a.example.com");
});
