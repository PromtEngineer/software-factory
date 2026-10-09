import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#7 delete a link", async () => {
  const app = await start(); server = app.server;
  const { slug } = await (await post(app.base, "/links", { url: "https://d.example.com" })).json();
  expect((await fetch(`${app.base}/links/${slug}`, { method: "DELETE" })).status).toBe(204);
  expect((await fetch(`${app.base}/${slug}`, { redirect: "manual" })).status).toBe(404);
  expect((await fetch(`${app.base}/stats/${slug}`)).status).toBe(404);
  expect((await fetch(`${app.base}/links/${slug}`, { method: "DELETE" })).status).toBe(404);
});
