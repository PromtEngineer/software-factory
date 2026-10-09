/**
 * Morning smoke test: our own receipts for the video, and the go/no-go checks for the risky parts.
 *   UPSTASH_BOX_API_KEY=... npx tsx src/smoke.ts            (quick: ~3 minutes)
 *   UPSTASH_BOX_API_KEY=... npx tsx src/smoke.ts --long     (adds the 6-minute exec and 10-minute agent checks)
 * Writes runs/smoke-<time>.json.
 */
import "./http.js";
import { writeFile, mkdir } from "node:fs/promises";
import { Agent, Box, ClaudeCode } from "@upstash/box";
import { z } from "zod/v3";

const long = process.argv.includes("--long");
const FANOUT = Number(process.env.FANOUT ?? 10);
const results: Record<string, unknown> = { startedAt: new Date().toISOString(), sdk: "0.7.7" };
const boxes: Box[] = [];
const ms = (t0: number) => Math.round(performance.now() - t0);
const log = (k: string, v: unknown) => { results[k] = v; console.log(k, JSON.stringify(v)); };

try {
  // 1. Cold create.
  let t0 = performance.now();
  const base = await Box.create({ runtime: "node", size: "small", name: "smoke-base" });
  boxes.push(base);
  log("create_ms", ms(t0));

  // 2. Prepare a workspace and snapshot it.
  await base.exec.command("mkdir -p app && cd app && npm init -y >/dev/null && npm i zod@3 >/dev/null && echo ok");
  t0 = performance.now();
  const snap = await base.snapshot({ name: "smoke-base" });
  log("snapshot_ms", ms(t0));

  // 3. Fan out 10 workers from the snapshot in parallel; each proves the install survived.
  t0 = performance.now();
  const workers = await Promise.all(Array.from({ length: FANOUT }, (_, i) => Box.fromSnapshot(snap.id, { size: "small", name: `smoke-w${i}` })));
  boxes.push(...workers);
  const restoreMs = ms(t0);
  const checks = await Promise.all(workers.map((w) => w.exec.command("cd app && node -e \"require('zod'); console.log('ok')\"")));
  log(`fanout_${FANOUT}`, { restoreMs, allOk: checks.every((c) => c.result.trim() === "ok") });

  // 4. Isolation: a file written in one worker is invisible to another.
  await workers[0].exec.command("echo secret > /tmp/only-here");
  const peek = await workers[1].exec.command("cat /tmp/only-here 2>&1 || true");
  log("isolation_file_not_shared", !peek.result.includes("secret"));

  // 5. Egress policy: allow npm, deny everything else.
  const locked = await Box.create({ runtime: "node", size: "small", name: "smoke-egress", networkPolicy: { mode: "custom", allowedDomains: ["registry.npmjs.org"] } });
  boxes.push(locked);
  const ok = await locked.exec.command("curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/zod");
  const denied = await locked.exec.command("curl -s --max-time 8 -o /dev/null -w '%{http_code}' https://example.com || echo blocked");
  log("egress", { npm: ok.result.trim(), example: denied.result.trim() });

  // 6. Persistence across pause/resume.
  await base.exec.command("echo persisted > /workspace/home/state.txt");
  await base.pause();
  t0 = performance.now();
  await base.resume();
  const state = await base.exec.command("cat /workspace/home/state.txt");
  log("pause_resume", { resumeMs: ms(t0), persisted: state.result.trim() === "persisted" });

  // 7. A short typed agent run on the Upstash-provided LLM key (no model key needed).
  const agentBox = await Box.create({ runtime: "node", size: "small", name: "smoke-agent", agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 } });
  boxes.push(agentBox);
  t0 = performance.now();
  const run = await agentBox.agent.run({
    prompt: "Create hello.txt containing exactly hi, then report.",
    responseSchema: z.object({ created: z.boolean(), content: z.string() }),
    options: { maxTurns: 5, maxBudgetUsd: 0.25 },
  });
  log("agent_short", { ms: ms(t0), result: run.result, costUsd: run.cost?.totalUsd });

  // 7b. Does the built-in agent still reach its model when egress is locked to npm + GitHub only?
  //     If this fails, the model endpoint must be added to the allowlist (read it from the box logs).
  const lockedAgent = await Box.create({
    runtime: "node", size: "small", name: "smoke-agent-locked",
    agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    networkPolicy: { mode: "custom", allowedDomains: ["registry.npmjs.org", "github.com"] },
  });
  boxes.push(lockedAgent);
  t0 = performance.now();
  try {
    const r = await lockedAgent.agent.run({ prompt: "Reply with the word ok.", options: { maxTurns: 2, maxBudgetUsd: 0.05 }, timeout: 120_000 });
    log("agent_with_locked_egress", { ms: ms(t0), status: r.status, out: String(r.result).slice(0, 60) });
  } catch (e: any) {
    log("agent_with_locked_egress", { ms: ms(t0), error: String(e?.message ?? e).slice(0, 300) });
  }

  if (long) {
    // 8. Issue #160: does a 6-minute exec return, or 500?
    t0 = performance.now();
    try {
      const r = await workers[2].exec.command("sleep 360 && echo done");
      log("exec_6min", { ms: ms(t0), status: r.status, out: r.result.trim() });
    } catch (e: any) {
      log("exec_6min", { ms: ms(t0), error: String(e?.message ?? e).slice(0, 300) });
    }
    // 9. Does a 10-minute agent run return cleanly?
    t0 = performance.now();
    try {
      const r = await agentBox.agent.run({
        prompt: "Run `sleep 600` in the shell (it takes ten minutes; wait for it), then reply with the single word finished.",
        options: { maxTurns: 5 },
        timeout: 20 * 60_000,
      });
      log("agent_10min", { ms: ms(t0), status: r.status, out: String(r.result).slice(0, 100) });
    } catch (e: any) {
      log("agent_10min", { ms: ms(t0), error: String(e?.message ?? e).slice(0, 300) });
    }
  }
  await base.deleteSnapshot(snap.id).catch(() => {});
} finally {
  await Promise.allSettled(boxes.map((b) => b.delete()));
  await mkdir("runs", { recursive: true });
  const f = `runs/smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(f, JSON.stringify(results, null, 2));
  console.log("wrote", f);
}
