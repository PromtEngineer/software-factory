/** Does the box agent actually call Context7 when told to? Read the box's own query log afterwards. */
import "./http.js";
import { Agent, Box, ClaudeCode } from "@upstash/box";
import { z } from "zod/v3";
import { DOCS_SCRIPT } from "./upstash.js";
import { writeFile } from "node:fs/promises";

const box = await Box.create({ runtime: "node", size: "small", name: "grounding-control", agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_5, ...(process.env.FACTORY_LLM_KEY ? { apiKey: process.env.FACTORY_LLM_KEY } : {}) } });
try {
  await box.files.write({ path: "/workspace/home/bin/docs", content: DOCS_SCRIPT });
  const who = await box.exec.command("chmod +x /workspace/home/bin/docs && (ln -sf /workspace/home/bin/docs /usr/local/bin/docs && echo linked || echo no-link); whoami; which docs");
  await box.exec.command("mkdir -p /workspace/home/app && cd /workspace/home/app && npm init -y >/dev/null && npm i zod@4 vitest >/dev/null 2>&1 && npm pkg set scripts.test='vitest run' type=module && echo ok");
  await box.cd("/workspace/home/app");
  const t0 = performance.now();
  const run = await box.agent.run({
    prompt: `Add src/link.ts exporting a zod schema \`linkSchema\` for a JSON body {url, slug?}. url must be an absolute http or https URL; anything else fails with the message "invalid url". slug is optional, 3-32 chars of [a-z0-9-]. Add test/link.test.ts with vitest covering both. Run npm test until it passes.`,
    responseSchema: z.object({ testsPass: z.boolean(), summary: z.string() }),
    options: { maxTurns: 40, maxBudgetUsd: 1.5 },
    timeout: 15 * 60_000,
  });
  const out = {
    setup: who.result.trim(),
    seconds: Math.round((performance.now() - t0) / 1000),
    result: run.result, costUsd: run.cost?.totalUsd,
    docsLog: (await box.exec.command("cat /workspace/home/docs-queries.log 2>&1")).result.trim(),
    code: (await box.exec.command("cat src/link.ts")).result,
    verifierTests: (await box.exec.command("npx vitest run 2>&1 | tail -5")).result.trim(),
    zodVersion: (await box.exec.command("node -p \"require('zod/package.json').version\"")).result.trim(),
  };
  await writeFile("runs/grounding-test-control.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally { await box.delete(); }
