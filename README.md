# Software factory on Upstash Box

This repository has the software factory from the video *What is a software factory? (and how to build one)*. It takes GitHub issues in, has Claude Code agents fix them, checks every change with tests and a separate reviewer, and opens pull requests for a human to merge. Each agent runs in its own cloud sandbox on [Upstash Box](https://upstash.com/box).

## Results (run on October 5, 2026)

The factory ran on the `tinylinks` demo app (in `demo-repo/`) with 10 GitHub issues: 4 bugs, 5 features and 1 deliberately vague request.

| What | Result |
|---|---|
| Wall clock, 10 issues, 5 at a time | 4 min 34 s |
| Pull requests opened | 9 (every one approved by the reviewer, `npm test` passing) |
| Vague issue (#10) | Triaged out, as intended |
| Hidden tests the agents never saw | 9 of 9 pass |
| Model cost, factory run | $3.67 (Claude Code, Sonnet 5) |
| Merging all 9 PRs together | 7 of 9 conflicted; the integrator resolved them, 24 tests pass, $6.37 |
| Box compute for the whole day of runs | about $0.01 |

In an earlier rehearsal run, the reviewer rejected a change to issue #8 even though the worker's tests, the verifier's `npm test` and the hidden test all passed. Links created in the same millisecond came back in alphabetical order instead of creation order. The full review is in `results/rehearsal-run.json`.

The raw run records are in `results/`. Their pull request links point to the original demo repo, which is private.

## How it works

Every issue goes through four stages in three fresh boxes, each started from one snapshot:

1. **Claim.** The factory puts a `factory:claimed` label on the issue so no other lane picks it up.
2. **Triage** (box 1). An agent reads the issue and decides whether it is clear enough to build.
3. **Worker** (box 2). An agent writes the fix and tests, returns a typed report (`status`, `summary`, `filesChanged`, `testsAdded`, `testsPass`), and the factory pushes its branch.
4. **Verifier and reviewer** (box 3). A fresh box checks out the branch and runs `npm test` itself. Then a reviewer agent in the same box reads the diff and approves or requests changes.
5. **Pull request.** Only when tests pass and the reviewer approves does the factory open a PR. A human merges.

Stages hand off typed JSON objects (zod schemas in `src/factory.ts`), not chat history.

**Live docs.** With `--grounding`, every box gets a small `docs` command that queries [Context7](https://context7.com) Search, and the agents are told to look up any API they are unsure about. The Context7 key is attached by Upstash to outbound requests from outside the box, so the agent never sees it.

**Integrator.** `src/integrate.ts` merges the factory's PR branches one at a time into an integration branch in its own box. When a merge conflicts, a Claude Code agent resolves it, keeping both sides, and the full test suite runs after every merge.

## Run it yourself

You need Node 22 or later, zsh (for the demo scripts), the `gh` CLI, an [Upstash](https://console.upstash.com) account with a Box API key, and a GitHub account.

1. Install the dependencies:

   ```bash
   npm install
   (cd demo-repo/tinylinks && npm install)
   ```

2. Create your own copy of the demo repo with its 10 issues. This creates a private repo under your account:

   ```bash
   demo-repo/seed_github.sh <your-github-user>/tinylinks
   ```

3. Copy `.env.example` to `.env` and fill it in. Use a fine-grained GitHub token limited to your tinylinks repo.

4. Run the factory on your repo's open issues:

   ```bash
   node --env-file=.env node_modules/.bin/tsx src/run.ts --backend upstash \
     --issues gh:<your-github-user>/tinylinks --concurrency 5 --grounding --live-tools
   ```

   Results go to `runs/`. Add `--branch-prefix factory/run2` to start a fresh set of branches.

5. Score the PR branches against the hidden tests:

   ```bash
   node --env-file=.env node_modules/.bin/tsx src/score.ts runs/<run-file>.json
   ```

6. Merge every PR branch into an integration branch, with an agent resolving conflicts:

   ```bash
   node --env-file=.env node_modules/.bin/tsx src/integrate.ts --prefix factory --into demo/after
   ```

### Costs and limits

- Agents use Upstash's built-in model budget unless you set `FACTORY_LLM_KEY`. That budget has a monthly cap (it was $10 a month on the Pay as You Go plan when we ran this). For more than a few runs, set `FACTORY_LLM_KEY` to your own Anthropic API key, with prepaid credit.
- Box compute is billed for active CPU time, so it is small: the agents spend most of their time waiting on the model.

## What's in this repo

| Path | What it is |
|---|---|
| `src/run.ts` | Entry point: loads issues, runs the lanes, writes results |
| `src/factory.ts` | The pipeline, prompts, typed handoffs and claim strategies |
| `src/upstash.ts` | The Upstash Box backend: base box, snapshot, boxes per stage, the Context7 `docs` tool |
| `src/integrate.ts` | The integrator stage |
| `src/score.ts` | Scores PR branches against the hidden tests |
| `src/local.ts` | A local backend (one clone per worker, or a shared checkout for comparison), useful for dry runs |
| `src/smoke.ts` | Smoke test of the Box primitives (create, snapshot, fan-out, isolation, egress, pause and resume) |
| `demo/` | The short scripts recorded for the video (box basics, cloud vs laptop, Context7, app checks, hidden tests, egress allowlist) |
| `demo-repo/tinylinks/` | The demo app the agents work on |
| `demo-repo/issues.json` | The 10 issues |
| `demo-repo/hidden-tests/` | One hidden test per issue, kept outside the app so agents never see them |
| `demo-repo/reference/` | A reference solution that passes all 9 hidden tests |
| `results/` | Records of the recorded run and the rehearsal run |

## License

MIT. See `LICENSE`.
