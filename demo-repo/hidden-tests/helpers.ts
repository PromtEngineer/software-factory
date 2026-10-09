import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type AppOptions } from "../src/server.js";

export async function start(opts: AppOptions = {}): Promise<{ base: string; server: Server }> {
  const server = createApp(opts);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

export async function stop(server: Server) {
  await new Promise<void>((r) => server.close(() => r()));
}

export const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
