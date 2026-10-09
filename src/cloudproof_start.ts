/** Proof that work runs on Upstash, not on this Mac. Part 1: start work, then exit. */
import "./http.js";
import os from "node:os";
import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { Agent, Box, ClaudeCode } from "@upstash/box";
import { z } from "zod/v3";

const mac = { hostname: os.hostname(), uname: execSync("uname -a").toString().trim(), publicIp: execSync("curl -s https://checkip.amazonaws.com").toString().trim() };
const box = await Box.create({ runtime: "node", size: "small", name: "cloud-proof", agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 } });

// 1. The agent's tools execute inside the box.
const run = await box.agent.run({
  prompt: "Run these shell commands: `uname -a`, `hostname`, `curl -s https://checkip.amazonaws.com`. Save their combined output to /workspace/home/agent-proof.txt and report each value.",
  responseSchema: z.object({ uname: z.string(), hostname: z.string(), publicIp: z.string() }),
  options: { maxTurns: 6, maxBudgetUsd: 0.2 },
});

// 2. A heartbeat every minute, and one agent run ~3 minutes from now, both owned by the box.
await box.schedule.exec({ cron: "* * * * *", command: ["bash", "-lc", "echo \"$(date -u +%H:%M:%S) heartbeat from $(hostname)\" >> /workspace/home/heartbeat.log"] });
const at = new Date(Date.now() + 3 * 60_000);
await box.schedule.agent({
  cron: `${at.getUTCMinutes()} ${at.getUTCHours()} * * *`,
  prompt: "Append one line to /workspace/home/agent-heartbeat.log containing the output of `date -u +%H:%M:%S` followed by the words 'agent ran on' and the output of `hostname`. Do nothing else.",
  options: { maxTurns: 4, maxBudgetUsd: 0.1 },
});

const startExit = new Date().toISOString();
const state = { boxId: box.id, mac, agentRun: { result: run.result, costUsd: run.cost?.totalUsd }, agentScheduledForUtc: at.toISOString(), startProcessExitedAt: startExit };
await writeFile("runs/cloudproof-state.json", JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
