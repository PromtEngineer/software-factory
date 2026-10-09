import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomSlug } from "./slug.js";
import { normalizeUrl } from "./url.js";
import { LinkStore } from "./store.js";
export interface AppOptions { store?: LinkStore; slugFn?: () => string; }
function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8"); return raw ? JSON.parse(raw) : {};
}
const view = (l: { slug: string; url: string; createdAt: number; clicks: number }) => ({ slug: l.slug, url: l.url, createdAt: l.createdAt, clicks: l.clicks });
export function createApp(opts: AppOptions = {}): Server {
  const store = opts.store ?? new LinkStore(); const slugFn = opts.slugFn ?? (() => randomSlug());
  const hits = new Map<string, number[]>();
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost"); const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "POST" && url.pathname === "/links") {
        const ip = req.socket.remoteAddress ?? "?"; const now = Date.now();
        const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= 10) { hits.set(ip, recent); return send(res, 429, { error: "rate limited" }, { "retry-after": String(Math.ceil((60_000 - (now - recent[0])) / 1000)) }); }
        recent.push(now); hits.set(ip, recent);
        const body = await readJson(req); const target = normalizeUrl(body.url);
        if (!target) return send(res, 400, { error: "invalid url" });
        let expiresAt: number | undefined;
        if (body.expiresInSeconds !== undefined) {
          if (!Number.isInteger(body.expiresInSeconds) || body.expiresInSeconds <= 0) return send(res, 400, { error: "invalid expiresInSeconds" });
          expiresAt = now + body.expiresInSeconds * 1000;
        }
        let slug: string;
        if (body.slug !== undefined) {
          if (typeof body.slug !== "string" || !/^[a-z0-9-]{3,32}$/.test(body.slug)) return send(res, 400, { error: "invalid slug" });
          if (store.has(body.slug)) return send(res, 409, { error: "slug taken" });
          slug = body.slug;
        } else {
          let tries = 0; do { slug = slugFn(); } while (store.has(slug) && ++tries < 50);
          if (store.has(slug)) return send(res, 500, { error: "could not allocate slug" });
        }
        return send(res, 201, view(store.create(target, slug, now, expiresAt)));
      }
      if (req.method === "GET" && url.pathname === "/links") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
        const all = store.all(); const cur = url.searchParams.get("cursor");
        const start = cur ? all.findIndex((l) => String(l.seq) === cur) + 1 : 0;
        const items = all.slice(start, start + limit);
        const nextCursor = start + limit < all.length ? String(items[items.length - 1].seq) : null;
        return send(res, 200, { items: items.map(view), nextCursor });
      }
      if (req.method === "DELETE" && parts[0] === "links" && parts.length === 2) {
        return store.delete(parts[1]) ? send(res, 204) : send(res, 404, { error: "not found" });
      }
      if (req.method === "GET" && parts[0] === "stats" && parts.length === 2) {
        const link = store.get(parts[1]); if (!link) return send(res, 404, { error: "not found" });
        return send(res, 200, { slug: link.slug, clicks: link.clicks, url: link.url });
      }
      if ((req.method === "GET" || req.method === "HEAD") && parts.length === 1) {
        const link = store.get(parts[0]); if (!link) return send(res, 404, { error: "not found" });
        if (link.expiresAt !== undefined && Date.now() >= link.expiresAt) return send(res, 410, { error: "expired" });
        if (req.method === "GET") store.recordClick(link.slug);
        res.writeHead(302, { location: link.url }); return res.end();
      }
      send(res, 404, { error: "not found" });
    } catch { send(res, 500, { error: "internal error" }); }
  });
}
