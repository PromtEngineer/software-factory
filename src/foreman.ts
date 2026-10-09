/**
 * The foreman: puts the orchestrator itself in an Upstash Box and runs it on a cron schedule,
 * so nothing runs on your laptop overnight.
 *
 *   UPSTASH_BOX_API_KEY=... GITHUB_TOKEN=... FACTORY_REPO=github.com/you/tinylinks \
 *     npx tsx src/foreman.ts --cron "0 * * * *"
 *
 * Every run it reads open issues labelled `factory`, claims each one with a `factory:claimed` label
 * (so an issue that is already taken is skipped), and fans out one worker box per issue.
 * The foreman box itself runs no coding agent: it only executes this repo's code.
 */
import "./http.js";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Box } from "@upstash/box";

const here = dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: { cron: { type: "string", default: "0 * * * *" }, concurrency: { type: "string", default: "8" } } });

const need = ["UPSTASH_BOX_API_KEY", "GITHUB_TOKEN", "FACTORY_REPO"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);
const repoPath = process.env.FACTORY_REPO!.replace(/^github\.com\//, "");

const foreman = await Box.create({
  runtime: "node",
  size: "small",
  name: "factory-foreman",
  labels: ["factory", "foreman"],
  env: Object.fromEntries(need.map((k) => [k, process.env[k]!]).concat(process.env.FACTORY_LLM_KEY ? [["FACTORY_LLM_KEY", process.env.FACTORY_LLM_KEY]] : [])),
});

// Ship the orchestrator code into the foreman box.
await foreman.exec.command("mkdir -p /workspace/home/factory/src");
for (const f of ["package.json", "tsconfig.json", "src/http.ts", "src/sandbox.ts", "src/factory.ts", "src/upstash.ts", "src/local.ts", "src/run.ts"]) {
  await foreman.files.write({ path: `/workspace/home/factory/${f}`, content: await readFile(join(resolve(here, ".."), f), "utf8") });
}
const install = await foreman.exec.command("cd /workspace/home/factory && npm install --no-audit --no-fund");
if (install.status !== "completed") throw new Error(install.result);

const schedule = await foreman.schedule.exec({
  cron: a.cron!,
  command: ["bash", "-lc", `cd /workspace/home/factory && npx tsx src/run.ts --backend upstash --issues gh:${repoPath} --concurrency ${a.concurrency} >> /workspace/home/factory/foreman.log 2>&1`],
  folder: "/workspace/home/factory",
});
console.log(`foreman ${foreman.id} scheduled (${a.cron}) as ${schedule.id}. Logs: /workspace/home/factory/foreman.log and runs/*.json inside the box.`);
