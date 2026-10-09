/** Part 2: reconnect from a fresh process and read what the box did on its own. Then clean up. */
import "./http.js";
import { readFile, writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
const state = JSON.parse(await readFile("runs/cloudproof-state.json", "utf8"));
const box = await Box.get(state.boxId);
const read = async (c: string) => (await box.exec.command(c)).result.trim();
const out = {
  ...state,
  checkedAt: new Date().toISOString(),
  agentProofFile: await read("cat /workspace/home/agent-proof.txt 2>&1"),
  heartbeat: await read("cat /workspace/home/heartbeat.log 2>&1"),
  agentHeartbeat: await read("cat /workspace/home/agent-heartbeat.log 2>&1"),
};
for (const s of await box.schedule.list()) await box.schedule.delete(s.id);
await box.delete();
await writeFile("runs/cloudproof-result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
