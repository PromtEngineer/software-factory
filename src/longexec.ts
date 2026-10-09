/** Is the 5-minute exec cutoff (issue #160) Upstash's or Node's fetch timeout?
 *   MODE=command-notimeout  exec.command with undici headers/body timeouts disabled
 *   MODE=stream             exec.stream with Node's default fetch, output every 10 s */
import { Box } from "@upstash/box";
import { Agent, setGlobalDispatcher } from "undici";
const mode = process.env.MODE!;
if (mode === "command-notimeout") setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));
const box = await Box.create({ runtime: "node", size: "small", name: `longexec-${mode}` });
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
try {
  if (mode === "stream") {
    const run = await box.exec.stream("for i in $(seq 1 36); do sleep 10; echo tick $i; done; echo done");
    let last = "";
    for await (const c of run as any) { last = JSON.stringify(c).slice(0, 120); }
    console.log(JSON.stringify({ mode, ms: ms(), status: run.status, last }));
  } else {
    const r = await box.exec.command("sleep 360 && echo done");
    console.log(JSON.stringify({ mode, ms: ms(), status: r.status, out: r.result.trim() }));
  }
} catch (e: any) {
  console.log(JSON.stringify({ mode, ms: ms(), error: String(e?.message ?? e), cause: String(e?.cause?.code ?? e?.cause?.message ?? e?.cause ?? "") }));
} finally { await box.delete(); }
