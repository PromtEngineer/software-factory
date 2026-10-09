/**
 * Integrator stage: merge the factory's open PRs one by one into an integration branch, in one box.
 * When a merge conflicts, a Claude Code agent resolves it (keeping both sides) and the tests must pass
 * before the next merge. `main` is never touched; a human reviews the integration branch.
 *
 *   npx tsx src/integrate.ts --prefix factory/rec --into demo/after
 */
import "./http.js";
import { parseArgs } from "node:util";
import { Agent, Box, ClaudeCode } from "@upstash/box";
import { z } from "zod/v3";

const { values: a } = parseArgs({ options: { prefix: { type: "string", default: "factory/rec" }, into: { type: "string", default: "demo/after" } } });
const repo = process.env.FACTORY_REPO!.replace(/^(?!https?:\/\/)/, "https://");
const slug = repo.replace("https://github.com/", "");
const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", cy: "\x1b[36m", y: "\x1b[33m", x: "\x1b[0m" };
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

// The PRs the factory opened, oldest first.
const prs = (await (await fetch(`https://api.github.com/repos/${slug}/pulls?state=open&per_page=100`, {
  headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
})).json() as any[]).filter((p) => p.head.ref.startsWith(`${a.prefix}/`)).sort((x, y) => x.number - y.number);
log(`${c.b}${prs.length} open factory PRs to integrate into ${a.into}${c.x}`);

const box = await Box.create({
  runtime: "node", size: "small", name: "integrator", labels: ["factory"],
  git: { token: process.env.GITHUB_TOKEN!, userName: "factory-bot", userEmail: "factory-bot@users.noreply.github.com" },
  agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_5, ...(process.env.FACTORY_LLM_KEY ? { apiKey: process.env.FACTORY_LLM_KEY } : {}) },
});
const git = async (...args: string[]) => box.git.exec({ args });
const sh = async (cmd: string) => box.exec.command(cmd);
let cost = 0;
try {
  await box.git.clone({ repo, branch: "main" });
  await box.cd(repo.split("/").pop()!);
  await sh("npm ci --no-audit --no-fund >/dev/null 2>&1");
  await git("fetch", "origin", `+refs/heads/${a.prefix}/*:refs/remotes/origin/${a.prefix}/*`);
  // Resume: start from the integration branch if an earlier run already pushed part of it.
  const resumed = (await git("fetch", "origin", `+refs/heads/${a.into}:refs/remotes/origin/${a.into}`)).exit_code === 0;
  await git("checkout", "-B", a.into!, resumed ? `origin/${a.into}` : "origin/main");
  log(`integrator box ${c.b}${box.id}${c.x} ready, ${a.into} = ${resumed ? "previous progress" : "main"}`);

  for (const pr of prs) {
    const branch = pr.head.ref as string;
    if ((await git("merge-base", "--is-ancestor", `origin/${branch}`, "HEAD")).exit_code === 0) {
      log(`${c.dim}= PR #${pr.number} ${pr.title} already integrated${c.x}`);
      continue;
    }
    const m = await git("merge", "--no-ff", "--no-edit", `origin/${branch}`);
    if (m.exit_code === 0) {
      log(`${c.g}✓${c.x} PR #${pr.number} ${pr.title} ${c.dim}merged cleanly${c.x}`);
    } else {
      const files = (await git("diff", "--name-only", "--diff-filter=U")).output.trim().split("\n").filter(Boolean);
      log(`${c.y}!${c.x} PR #${pr.number} ${pr.title} ${c.y}conflicts in ${files.join(", ")}${c.x} → agent resolving`);
      let run;
      try { run = await box.agent.run({
        prompt: `You are the integrator in a software factory. In the repository in your current directory, \`git merge origin/${branch}\` (PR #${pr.number}: "${pr.title}") stopped with conflicts in: ${files.join(", ")}.
Resolve every conflict so that BOTH sides are kept: all behavior and all tests from the current branch AND from the incoming branch. Do not drop or weaken any test.
Then run \`npm test\` and fix any problem until it passes. Finally run \`git add -A && git commit --no-edit\` to conclude the merge.`,
        responseSchema: z.object({ resolved: z.boolean(), testsPass: z.boolean(), summary: z.string() }),
        options: { maxTurns: 40, maxBudgetUsd: 1.5 },
        timeout: 15 * 60_000,
        onToolUse: (t: { name: string; input: Record<string, unknown> }) => {
          const arg = String(t.input.command ?? t.input.file_path ?? t.input.description ?? "").replace(/\s+/g, " ");
          log(`   ${c.dim}integrator ▸ ${t.name} ${arg.length > 80 ? arg.slice(0, 77) + "..." : arg}${c.x}`);
        },
      }); } catch (e: any) {
        log(`${c.r}stopping: agent call failed: ${String(e?.message ?? e).slice(0, 120)}${c.x}`);
        await git("merge", "--abort");
        break;
      }
      cost += run.cost?.totalUsd ?? 0;
      log(`   ${run.result.resolved ? c.g + "resolved" : c.r + "NOT resolved"}${c.x}: ${run.result.summary.slice(0, 140)}`);
      const still = (await git("diff", "--name-only", "--diff-filter=U")).output.trim();
      if (still || !run.result.resolved) { log(`${c.r}stopping: unresolved conflicts${c.x}`); await git("merge", "--abort"); break; }
    }
    const t = await sh("npm test 2>&1 | tail -4");
    const passed = /passed/.test(t.result) && !/failed/.test(t.result);
    log(`   ${passed ? c.g + "tests pass" : c.r + "TESTS FAIL"}${c.x} ${c.dim}${(t.result.match(/Tests\s+[^\n]*/) ?? [""])[0].trim()}${c.x}`);
    if (!passed) { log(`${c.r}stopping: tests fail after PR #${pr.number}${c.x}`); break; }
    await box.git.push({ branch: a.into }); // save progress after every merge, so a failure never loses work
  }
  log(`${c.b}${a.into} pushed${c.x} (main untouched) · agent cost $${cost.toFixed(2)}`);
} finally {
  await box.delete();
}
