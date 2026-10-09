import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { post, start, stop } from "./helpers.js";
let server: Server; afterEach(async () => server && (await stop(server)));
it("#8 cursor pagination walks every link once, in order", async () => {
  let n = 0; const app = await start({ slugFn: () => `s${String(n++).padStart(3, "0")}` }); server = app.server;
  for (let i = 0; i < 5; i++) await post(app.base, "/links", { url: `https://p${i}.example.com` });
  const seen: string[] = []; let cursor: string | null = null; let pages = 0;
  do {
    const q = `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await (await fetch(`${app.base}/links?${q}`)).json();
    expect(page.items.length).toBeLessThanOrEqual(2);
    seen.push(...page.items.map((l: any) => l.url)); cursor = page.nextCursor; pages++;
  } while (cursor && pages < 10);
  expect(seen).toEqual([0, 1, 2, 3, 4].map((i) => `https://p${i}.example.com`));
  expect(pages).toBe(3);
  const all = await (await fetch(`${app.base}/links`)).json();
  expect(all.items.length).toBe(5); expect(all.nextCursor).toBeNull();
});
