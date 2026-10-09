import { z } from "zod/v3";
import type { Backend, Sandbox } from "./sandbox.js";

export interface Issue {
  id: number;
  title: string;
  body: string;
  labels: string[];
}

// ---- The typed handoffs between factory stages -------------------------------------------------

export const Triage = z.object({
  actionable: z.boolean().describe("true only if the issue states a concrete, testable outcome"),
  kind: z.enum(["bug", "feature", "chore", "unclear"]),
  reason: z.string().describe("one sentence"),
});

export const WorkReport = z.object({
  status: z.enum(["done", "blocked"]),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  testsAdded: z.boolean(),
  testsPass: z.boolean().describe("did `npm test` pass after your change"),
});

export const Review = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  issuesFound: z.array(z.string()),
});

export interface Outcome {
  issue: number;
  title: string;
  stage: "triaged_out" | "blocked" | "no_changes" | "rejected" | "ready_for_human";
  triage?: z.infer<typeof Triage>;
  work?: z.infer<typeof WorkReport>;
  review?: z.infer<typeof Review>;
  testsPassInVerifier?: boolean;
  /** true when the first verifier run failed and the retry passed. */
  flakyTests?: boolean;
  testOutput?: string;
  branch?: string;
  pr?: string;
  seconds: Record<string, number>;
  costUsd: number;
  error?: string;
  /** Every Context7 query the worker and reviewer made, read from the box's log (not self-reported). */
  docsQueries?: string[];
}

// ---- Claims: failure #1 ("two runs grab the same issue") ---------------------------------------

export interface ClaimStore {
  /** Returns true if this run now owns the issue. */
  claim(issue: number, owner: string): Promise<boolean>;
}

export class MemoryClaims implements ClaimStore {
  private owners = new Map<number, string>();
  async claim(issue: number, owner: string) {
    if (this.owners.has(issue)) return false;
    this.owners.set(issue, owner);
    return true;
  }
}

/** Upstash Redis claim: SET key owner NX EX 86400 over the REST API. Survives across runs and machines. */
export class RedisClaims implements ClaimStore {
  constructor(private url: string, private token: string) {}
  async claim(issue: number, owner: string) {
    const r = await fetch(`${this.url}/set/factory:claim:${issue}/${encodeURIComponent(owner)}/NX/EX/86400`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return (await r.json()).result === "OK";
  }
}

/**
 * GitHub label claim: the issue's labels are the queue. A run adds `factory:claimed` before working;
 * an issue that already has it is skipped. Not atomic across two simultaneous runs, so the foreman
 * runs one schedule at a time (cron interval longer than a run).
 */
export class GitHubLabelClaims implements ClaimStore {
  private local = new MemoryClaims();
  constructor(private repo: string, private token: string) {}
  private api(path: string, init: RequestInit = {}) {
    return fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "content-type": "application/json" },
    });
  }
  async claim(issue: number, owner: string) {
    if (!(await this.local.claim(issue, owner))) return false;
    const labels: { name: string }[] = await (await this.api(`/issues/${issue}/labels`)).json();
    if (labels.some((l) => l.name === "factory:claimed")) return false;
    const r = await this.api(`/issues/${issue}/labels`, { method: "POST", body: JSON.stringify({ labels: ["factory:claimed"] }) });
    return r.ok;
  }
}

// ---- Prompts ------------------------------------------------------------------------------------

const GROUNDING = `
Documentation:
- Before you use any library, framework, or Node.js API whose exact current signature you are not sure of, look it up: run \`docs "<your question>"\` (or \`/workspace/home/bin/docs\`). It returns current official documentation with source links. Write code from what it returns, not from memory.`;

const workPrompt = (i: Issue, grounded = false) => `You are one worker in a software factory. Resolve exactly this GitHub issue in the repository in your current directory, and nothing else.

Issue #${i.id}: ${i.title}
${i.body}

Rules:
- Read the relevant code first. Keep the change small and focused on this issue.
- Add or update tests under test/ that prove the fix.
- Run \`npm test\` and make it pass. Do not delete or weaken existing tests.
- Do not commit; the factory commits for you.
- If the issue cannot be resolved as written, stop and report status "blocked" with the reason.${grounded ? GROUNDING : ""}`;

const reviewPrompt = (i: Issue, grounded = false) => `You are the reviewer in a software factory. You did not write this change. The branch you are on holds another agent's change for the issue below. Run \`git diff origin/main...HEAD\` to see it. Do not modify any files.

Issue #${i.id}: ${i.title}
${i.body}

Check that the change does what the issue asks, including the edge cases it names, that it does not break other behavior, and that the tests really test the issue. Run \`npm test\`. Approve only if you would merge it.${grounded ? GROUNDING.replace("Write code from what it returns, not from memory.", "Use it to check that library calls in the diff match the current docs.") : ""}`;

// ---- The factory run ------------------------------------------------------------------------------

export interface RunOptions {
  backend: Backend;
  claims: ClaimStore;
  issues: Issue[];
  concurrency: number;
  runId: string;
  log?: (msg: string) => void;
  /** Skip the LLM triage and treat every issue as actionable (used for the shared-checkout comparison). */
  skipTriage?: boolean;
  /** Skip the separate reviewer sandbox. */
  skipReview?: boolean;
  /** Tell workers and reviewers to look up docs with `docs` (Context7 Search) before writing code. */
  grounding?: boolean;
  /** Branch name prefix, e.g. "factory/run2", so a new run never collides with an earlier run's branches. */
  branchPrefix?: string;
  /** Log every tool call the agents make (for watching a run live). */
  liveTools?: boolean;
}

async function timed<T>(seconds: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    seconds[key] = Math.round((Date.now() - t0) / 100) / 10;
  }
}

/** One short line per agent action, so a run can be watched live: "#2 worker  ▸ Edit src/url.ts". */
function toolLine(o: RunOptions, issue: number, role: string) {
  if (!o.liveTools || !o.log) return undefined;
  return (name: string, input: Record<string, unknown>) => {
    const arg = String(input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.description ?? "").replace(/\s+/g, " ");
    o.log!(`#${issue} ${role.padEnd(8)} ▸ ${name} ${arg.length > 90 ? arg.slice(0, 87) + "..." : arg}`);
  };
}

async function readDocsLog(sb: Sandbox, who: string): Promise<string[]> {
  const r = await sb.exec("cat /workspace/home/docs-queries.log 2>/dev/null || true");
  return r.output.split("\n").filter(Boolean).map((l) => `${who} ${l}`);
}

async function handle(o: RunOptions, issue: Issue): Promise<Outcome> {
  const log = o.log ?? (() => {});
  const out: Outcome = { issue: issue.id, title: issue.title, stage: "blocked", seconds: {}, costUsd: 0 };
  const branch = `${o.branchPrefix ?? "factory"}/issue-${issue.id}`;

  // 1. Triage in a throwaway sandbox: is there a concrete, testable outcome?
  if (!o.skipTriage) {
    const tri = await o.backend.sandbox(`triage-${issue.id}`);
    try {
      const t = await timed(out.seconds, "triage", () =>
        tri.agent(`Triage this GitHub issue for an automated coding agent. Do not change any files.\n\nIssue #${issue.id}: ${issue.title}\n${issue.body}`, Triage, { maxBudgetUsd: 0.2, timeoutMs: 180_000, onTool: toolLine(o, issue.id, "triage") }));
      out.triage = t.result;
      out.costUsd += t.costUsd;
    } finally {
      await tri.destroy();
    }
    if (!out.triage!.actionable) {
      log(`#${issue.id} triaged out: ${out.triage!.reason}`);
      out.stage = "triaged_out";
      return out;
    }
  }

  // 2. Build in its own sandbox. Nothing another worker does can touch this checkout.
  const worker = await o.backend.sandbox(`worker-${issue.id}`);
  try {
    const w = await timed(out.seconds, "build", () => worker.agent(workPrompt(issue, o.grounding), WorkReport, { maxBudgetUsd: 2, timeoutMs: 15 * 60_000, onTool: toolLine(o, issue.id, "worker") }));
    out.work = w.result;
    out.costUsd += w.costUsd;
    if (o.grounding) out.docsQueries = await readDocsLog(worker, "worker");
    log(`#${issue.id} worker: ${w.result.status}, tests ${w.result.testsPass ? "pass" : "fail"}, docs lookups ${out.docsQueries?.length ?? 0}`);
    if (w.result.status === "blocked") return { ...out, stage: "blocked" };
    const pushed = await worker.pushBranch(branch, `fix: ${issue.title} (#${issue.id})`);
    if (!pushed) return { ...out, stage: "no_changes" };
    out.branch = branch;
  } finally {
    await worker.destroy();
  }

  // 3. Verify in a FRESH sandbox: the worker never grades its own work.
  const verifier = await o.backend.sandbox(`verify-${issue.id}`);
  try {
    await verifier.checkout(branch);
    let tests = await timed(out.seconds, "tests", () => verifier.exec("npm test"));
    if (!tests.ok) {
      // One retry before rejecting: a single red run can be flaky rather than wrong.
      out.testOutput = tests.output.slice(-1500);
      tests = await verifier.exec("npm test");
      out.flakyTests = tests.ok;
    }
    out.testsPassInVerifier = tests.ok;
    if (!o.skipReview) {
      const r = await timed(out.seconds, "review", () => verifier.agent(reviewPrompt(issue, o.grounding), Review, { maxBudgetUsd: 1, timeoutMs: 8 * 60_000, onTool: toolLine(o, issue.id, "reviewer") }));
      out.review = r.result;
      if (o.grounding) out.docsQueries = [...(out.docsQueries ?? []), ...(await readDocsLog(verifier, "reviewer"))];
      out.costUsd += r.costUsd;
    }
    const approved = tests.ok && (o.skipReview || out.review?.verdict === "approve");
    log(`#${issue.id} verifier: tests ${tests.ok ? "pass" : "FAIL"}, review ${out.review?.verdict ?? "skipped"}`);
    if (!approved) return { ...out, stage: "rejected" };

    // 4. Open the PR. Merging stays a human decision.
    out.pr = await verifier.openPR(branch, `${issue.title} (#${issue.id})`,
      `Automated fix for #${issue.id}.\n\n${out.work!.summary}\n\nReviewer: ${out.review?.verdict ?? "skipped"}. Verifier \`npm test\`: pass.`);
    return { ...out, stage: "ready_for_human" };
  } finally {
    await verifier.destroy();
  }
}

/** Run every issue through triage -> build -> verify -> PR, `concurrency` at a time. */
export async function runFactory(o: RunOptions): Promise<Outcome[]> {
  const queue = [...o.issues];
  const results: Outcome[] = [];
  const lane = async (n: number) => {
    for (let issue = queue.shift(); issue; issue = queue.shift()) {
      if (!(await o.claims.claim(issue.id, `${o.runId}/lane-${n}`))) {
        o.log?.(`#${issue.id} already claimed, skipping`);
        continue;
      }
      const t0 = Date.now();
      try {
        results.push({ ...(await handle(o, issue)) });
      } catch (e: any) {
        results.push({ issue: issue.id, title: issue.title, stage: "blocked", seconds: {}, costUsd: 0, error: String(e?.message ?? e).slice(0, 500) });
        o.log?.(`#${issue.id} error: ${String(e?.message ?? e).slice(0, 200)}`);
      }
      results[results.length - 1].seconds.total = Math.round((Date.now() - t0) / 1000);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, (_, n) => lane(n)));
  return results.sort((a, b) => a.issue - b.issue);
}
