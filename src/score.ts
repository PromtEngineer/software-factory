/**
 * Score a finished run against the hidden acceptance tests.
 * Every pushed branch is scored, including ones the verifier rejected, so we can check the verifier too.
 *   npx tsx src/score.ts runs/<run>.json
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scoreSh = resolve(here, "../demo-repo/score.sh");
const file = process.argv[2];
const run = JSON.parse(readFileSync(file, "utf8"));
const sh = (cmd: string, cwd?: string) => execFileSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", maxBuffer: 32 << 20 });

function scoreBranch(branch: string, ids: number[]) {
  const dir = mkdtempSync(join(tmpdir(), "score-"));
  try {
    // Private repos need the token in the clone URL; accept "github.com/o/r" or "https://github.com/o/r".
    const path = String(run.origin).replace(/^https?:\/\//, "").replace(/\.git$/, "");
    const origin = path.startsWith("github.com/") && process.env.GITHUB_TOKEN
      ? `https://x-access-token:${process.env.GITHUB_TOKEN}@${path}.git`
      : run.origin;
    sh(`git clone -q "${origin}" repo && cd repo && git checkout -q "${branch}"`, dir);
    const out = sh(`"${scoreSh}" "${join(dir, "repo")}" ${ids.join(" ")}`);
    return Object.fromEntries(out.trim().split("\n").map((l) => { const [id, v] = l.split(" "); return [Number(id.slice(1)), v === "PASS"]; }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rows: any[] = [];
if (run.backend === "local-shared") {
  const ids = run.results.map((r: any) => r.issue);
  const s = scoreBranch("factory/shared-all", ids);
  for (const r of run.results) rows.push({ issue: r.issue, stage: r.stage, agentSaidTestsPass: r.work?.testsPass, hiddenPass: s[r.issue] });
} else {
  for (const r of run.results) {
    const branch = r.branch ?? (r.stage === "ready_for_human" || r.stage === "rejected" ? `factory/issue-${r.issue}` : undefined);
    const hidden = branch && r.issue <= 9 ? scoreBranch(branch, [r.issue])[r.issue] : undefined;
    rows.push({
      issue: r.issue, stage: r.stage, triage: r.triage?.actionable, agentSaidTestsPass: r.work?.testsPass,
      verifierTests: r.testsPassInVerifier, review: r.review?.verdict, hiddenPass: hidden, total_s: r.seconds?.total, error: r.error?.slice(0, 80),
    });
  }
}
const summary = {
  run: run.runId, backend: run.backend, wallSeconds: run.wallSeconds,
  prsOpened: rows.filter((r) => r.stage === "ready_for_human").length,
  hiddenPassAmongPRs: rows.filter((r) => r.stage === "ready_for_human" && r.hiddenPass).length,
  hiddenPassAll: rows.filter((r) => r.hiddenPass).length,
  rejectedButCorrect: rows.filter((r) => r.stage === "rejected" && r.hiddenPass).length,
  approvedButWrong: rows.filter((r) => r.stage === "ready_for_human" && r.hiddenPass === false).length,
  vagueIssueTriagedOut: rows.find((r) => r.issue === 10)?.stage === "triaged_out",
  rows,
};
writeFileSync(file.replace(/\.json$/, ".score.json"), JSON.stringify(summary, null, 2));
console.table(rows);
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
