/**
 * Software factory entry point.
 *
 *   Upstash Box (the real thing):
 *     UPSTASH_BOX_API_KEY=... GITHUB_TOKEN=... FACTORY_REPO=github.com/you/tinylinks \
 *       npx tsx src/run.ts --backend upstash --concurrency 9
 *     Claims: with --issues gh:owner/repo, issues are claimed with a `factory:claimed` label.
 *     Optional: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN for atomic claims instead,
 *               FACTORY_LLM_KEY to bring your own Anthropic key instead of the Upstash-provided budget.
 *
 *   Local dry run (no account needed; pi + Gemini, one clone per worker):
 *     GEMINI_API_KEY=... npx tsx src/run.ts --backend local --concurrency 5
 *
 *   Shared-checkout comparison (every agent in ONE folder, like running them on your laptop):
 *     npx tsx src/run.ts --backend local --mode shared --concurrency 5
 */
import "./http.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LocalBackend } from "./local.js";
import { UpstashBackend } from "./upstash.js";
import { GitHubLabelClaims, MemoryClaims, RedisClaims, WorkReport, runFactory, type Issue, type Outcome } from "./factory.js";

const here = dirname(fileURLToPath(import.meta.url));
const demo = resolve(here, "../demo-repo");

const { values: a } = parseArgs({
  options: {
    backend: { type: "string", default: "local" },
    mode: { type: "string", default: "isolated" },
    concurrency: { type: "string", default: "5" },
    issues: { type: "string", default: join(demo, "issues.json") },
    only: { type: "string" },
    out: { type: "string", default: resolve(here, "../runs") },
    model: { type: "string" },
    // Ground workers and reviewers with Context7 Search (`docs` command). CONTEXT7_API_KEY is optional.
    grounding: { type: "boolean", default: false },
    // Branches become <prefix>/issue-N. Use a new prefix per run so runs never collide.
    "branch-prefix": { type: "string", default: "factory" },
    "live-tools": { type: "boolean", default: false },
  },
});

/** `--issues gh:owner/repo` reads open issues labelled "factory"; anything else is a JSON file path. */
async function loadIssues(src: string): Promise<Issue[]> {
  if (!src.startsWith("gh:")) return JSON.parse(await readFile(src, "utf8"));
  const r = await fetch(`https://api.github.com/repos/${src.slice(3)}/issues?labels=factory&state=open&per_page=100`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return (await r.json())
    .filter((i: any) => !i.pull_request)
    .map((i: any) => ({ id: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l: any) => l.name) }));
}
const issues = await loadIssues(a.issues!);
const selected = a.only ? issues.filter((i) => a.only!.split(",").map(Number).includes(i.id)) : issues;
const runId = `${a.backend}-${a.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;

const backend =
  a.backend === "upstash"
    ? new UpstashBackend({ repo: process.env.FACTORY_REPO!.replace(/^(?!https?:\/\/)/, "https://"), githubToken: process.env.GITHUB_TOKEN!, llmApiKey: process.env.FACTORY_LLM_KEY, model: a.model,
        // e.g. FACTORY_EGRESS=registry.npmjs.org,github.com,api.github.com,codeload.github.com,<model domain from smoke.ts>
        egressAllowlist: process.env.FACTORY_EGRESS?.split(","),
        context7: a.grounding ? { apiKey: process.env.CONTEXT7_API_KEY } : undefined })
    : new LocalBackend({ repo: join(demo, "tinylinks"), nodeModules: join(demo, "tinylinks/node_modules"), mode: a.mode as "isolated" | "shared", model: a.model });

const claims =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new RedisClaims(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN)
    : a.issues!.startsWith("gh:") && process.env.GITHUB_TOKEN
      ? new GitHubLabelClaims(a.issues!.slice(3), process.env.GITHUB_TOKEN)
      : new MemoryClaims();

const started = Date.now();
log(`run ${runId}: ${selected.length} issues, backend ${backend.name}, concurrency ${a.concurrency}`);
let results: Outcome[];
try {
await backend.prepare();
log(`base environment ready in ${Math.round((Date.now() - started) / 1000)}s`);

if (a.mode === "shared") {
  // Every agent works in the same checkout at the same time. No triage, no verifier: we only
  // want to see what concurrent agents do to one working tree.
  results = await Promise.all(
    selected.map(async (issue) => {
      const sb = await backend.sandbox(`shared-${issue.id}`);
      const t0 = Date.now();
      try {
        const w = await sb.agent(
          `You are one of several agents working in this repository right now. Resolve exactly this GitHub issue:\n\nIssue #${issue.id}: ${issue.title}\n${issue.body}\n\nAdd tests, run \`npm test\` and make it pass. Do not commit.`,
          WorkReport,
        );
        log(`#${issue.id} shared worker: ${w.result.status}, tests ${w.result.testsPass ? "pass" : "fail"}`);
        return { issue: issue.id, title: issue.title, stage: "ready_for_human", work: w.result, seconds: { total: Math.round((Date.now() - t0) / 1000) }, costUsd: 0 } as Outcome;
      } catch (e: any) {
        return { issue: issue.id, title: issue.title, stage: "blocked", seconds: { total: Math.round((Date.now() - t0) / 1000) }, costUsd: 0, error: String(e.message).slice(0, 400) } as Outcome;
      }
    }),
  );
  // Freeze the shared tree as one branch so it can be scored.
  const sb = await backend.sandbox("shared-final");
  await sb.pushBranch("factory/shared-all", "all agents, one checkout");
  const final = await sb.exec("npm test 2>&1 | tail -15");
  log(`shared checkout final npm test: ${final.ok ? "pass" : "FAIL"}`);
  await writeFile(join(a.out!, `${runId}.shared-final-tests.txt`), final.output).catch(() => {});
} else {
  results = await runFactory({ backend, claims, issues: selected, concurrency: Number(a.concurrency), runId, log, grounding: a.grounding, branchPrefix: a["branch-prefix"], liveTools: a["live-tools"] });
}

} catch (e) {
  // Never leave boxes running after a crash.
  await backend.cleanup().catch(() => {});
  throw e;
}

const wall = Math.round((Date.now() - started) / 1000);
await backend.cleanup();
await mkdir(a.out!, { recursive: true });
const record = {
  runId, backend: backend.name, concurrency: Number(a.concurrency), wallSeconds: wall,
  origin: backend instanceof LocalBackend ? backend.originPath : process.env.FACTORY_REPO,
  totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0), results,
};
await writeFile(join(a.out!, `${runId}.json`), JSON.stringify(record, null, 2));
log(`done in ${wall}s -> ${join(a.out!, `${runId}.json`)}`);
for (const r of results) log(`  #${r.issue} ${r.stage}${r.pr ? ` ${r.pr}` : ""}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
