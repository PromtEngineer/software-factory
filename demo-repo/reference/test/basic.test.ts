import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";

let server: Server;
afterEach(async () => server && (await stop(server)));

describe("tinylinks", () => {
  it("creates a link and redirects", async () => {
    const app = await start();
    server = app.server;
    const created = await post(app.base, "/links", { url: "https://example.com/a" });
    expect(created.status).toBe(201);
    const { slug } = await created.json();
    const hop = await fetch(`${app.base}/${slug}`, { redirect: "manual" });
    expect(hop.status).toBe(302);
    expect(hop.headers.get("location")).toBe("https://example.com/a");
  });

  it("rejects garbage", async () => {
    const app = await start();
    server = app.server;
    const res = await post(app.base, "/links", { url: "not a url" });
    expect(res.status).toBe(400);
  });

  it("counts clicks", async () => {
    const app = await start();
    server = app.server;
    const { slug } = await (await post(app.base, "/links", { url: "https://example.com" })).json();
    await fetch(`${app.base}/${slug}`, { redirect: "manual" });
    const stats = await (await fetch(`${app.base}/stats/${slug}`)).json();
    expect(stats.clicks).toBe(1);
  });
});
