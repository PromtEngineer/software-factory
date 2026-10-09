import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomSlug } from "./slug.js";
import { isValidUrl } from "./url.js";
import { LinkStore } from "./store.js";

export interface AppOptions {
  store?: LinkStore;
  slugFn?: () => string;
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createApp(opts: AppOptions = {}): Server {
  const store = opts.store ?? new LinkStore();
  const slugFn = opts.slugFn ?? (() => randomSlug());

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "POST" && url.pathname === "/links") {
        const body = await readJson(req);
        if (!isValidUrl(body.url)) return send(res, 400, { error: "invalid url" });
        const link = store.create(body.url, slugFn());
        return send(res, 201, link);
      }

      if (req.method === "GET" && parts[0] === "stats" && parts.length === 2) {
        const link = store.get(parts[1])!;
        return send(res, 200, { slug: link.slug, clicks: link.clicks, url: link.url });
      }

      if ((req.method === "GET" || req.method === "HEAD") && parts.length === 1) {
        const link = store.get(parts[0]);
        if (!link) return send(res, 404, { error: "not found" });
        store.recordClick(link.slug);
        res.writeHead(302, { location: link.url });
        return res.end();
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: "internal error" });
    }
  });
}
