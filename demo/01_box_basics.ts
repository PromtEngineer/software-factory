// On-camera demo 1: what a box is, in about a minute. Every number printed here is measured live.
import "../src/http.js";
import { Box } from "@upstash/box";

const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", cy: "\x1b[36m", y: "\x1b[33m", r: "\x1b[0m" };
const step = (s: string) => console.log(`\n${c.b}${c.cy}▸ ${s}${c.r}`);
const ok = (s: string) => console.log(`  ${c.g}✓${c.r} ${s}`);
const out = (s: string) => console.log(s.trim().split("\n").map((l) => `  ${c.dim}${l}${c.r}`).join("\n"));
const secs = (t0: number) => ((performance.now() - t0) / 1000).toFixed(1) + " s";
const boxes: Box[] = [];

try {
  step("Create a box");
  let t0 = performance.now();
  const box = await Box.create({ runtime: "node", size: "small", name: "demo-box" });
  boxes.push(box);
  ok(`box ${c.b}${box.id}${c.r} ready in ${c.y}${secs(t0)}${c.r}`);

  step("Run a command inside it");
  out((await box.exec.command("uname -sm && node --version && df -h /workspace | tail -1 | awk '{print $2\" disk\"}'")).result);

  step("Install a dependency once, then snapshot the box");
  await box.exec.command("mkdir -p app && cd app && npm init -y >/dev/null && npm i zod@4 >/dev/null 2>&1");
  ok("zod installed");
  t0 = performance.now();
  const snap = await box.snapshot({ name: "demo-base" });
  ok(`snapshot ${c.b}${snap.id}${c.r} saved in ${c.y}${secs(t0)}${c.r}`);

  step("Start 5 boxes from the snapshot, in parallel");
  t0 = performance.now();
  const workers = await Promise.all(Array.from({ length: 5 }, (_, i) => Box.fromSnapshot(snap.id, { size: "small", name: `demo-worker-${i + 1}` })));
  boxes.push(...workers);
  ok(`5 boxes ready in ${c.y}${secs(t0)}${c.r}`);
  const checks = await Promise.all(workers.map((w) => w.exec.command("cd app && node -e \"require('zod'); console.log('ok')\"")));
  ok(`zod already installed in ${checks.filter((x) => x.result.trim() === "ok").length} of 5 (nothing reinstalled)`);

  step("Isolation: write a file in box 1, look for it in box 2");
  await workers[0].exec.command("echo 'only in box 1' > /workspace/home/note.txt");
  ok(`box 1 reads: ${(await workers[0].exec.command("cat /workspace/home/note.txt")).result.trim()}`);
  const peek = (await workers[1].exec.command("cat /workspace/home/note.txt 2>&1 || true")).result.trim();
  ok(`box 2 reads: ${c.dim}${peek}${c.r}`);

  step("Storage persists: pause the box, resume it, read the file back");
  await workers[0].pause();
  ok("paused");
  t0 = performance.now();
  await workers[0].resume();
  ok(`resumed in ${c.y}${secs(t0)}${c.r}, file says: ${(await workers[0].exec.command("cat /workspace/home/note.txt")).result.trim()}`);
  await box.deleteSnapshot(snap.id).catch(() => {});
} finally {
  step("Clean up");
  await Promise.allSettled(boxes.map((b) => b.delete()));
  ok(`${boxes.length} boxes deleted`);
}
