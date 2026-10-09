// On-camera demo 2: the agent runs on Upstash, not on this laptop.
import "../src/http.js";
import { execSync } from "node:child_process";
import { Agent, Box, ClaudeCode } from "@upstash/box";
import { z } from "zod/v3";

const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", cy: "\x1b[36m", y: "\x1b[33m", r: "\x1b[0m" };
const step = (s: string) => console.log(`\n${c.b}${c.cy}▸ ${s}${c.r}`);
const row = (k: string, mac: string, box: string) => console.log(`  ${k.padEnd(10)} ${mac.padEnd(28)} ${box}`);

step("This laptop");
const mac = { os: execSync("uname -sm").toString().trim(), ip: execSync("curl -s https://checkip.amazonaws.com").toString().trim() };
console.log(`  ${mac.os}   ${mac.ip}`);

step("Ask Claude Code, running inside a box, where it is");
const box = await Box.create({ runtime: "node", size: "small", name: "where-am-i", agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_5 } });
try {
  const run = await box.agent.run({
    prompt: "Run `uname -sm` and `curl -s https://checkip.amazonaws.com` in the shell and report both values exactly.",
    responseSchema: z.object({ os: z.string(), ip: z.string() }),
    options: { maxTurns: 4 },
  });
  console.log(`  ${c.dim}${JSON.stringify(run.result)}${c.r}`);
  step("Side by side");
  row("", `${c.b}laptop${c.r}`.padEnd(36), `${c.b}box${c.r}`);
  row("os", mac.os, run.result.os);
  row("ip", mac.ip, run.result.ip);
} finally { await box.delete(); }
