import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#2 scheme-less URLs are rejected or normalized, other schemes rejected", async () => {
  const app = await start(); server = app.server;
  const r = await post(app.base, "/links", { url: "example.com/x" });
  if (r.status === 201) {
    const { slug } = await r.json();
    const hop = await fetch(`${app.base}/${slug}`, { redirect: "manual" });
    expect(hop.headers.get("location")).toMatch(/^https:\/\/example\.com\/x$/);
  } else expect(r.status).toBe(400);
  for (const bad of ["javascript:alert(1)", "ftp://files.example.com/a", "data:text/html,hi"]) {
    expect((await post(app.base, "/links", { url: bad })).status).toBe(400);
  }
  expect((await post(app.base, "/links", { url: "http://ok.example.com" })).status).toBe(201);
});
