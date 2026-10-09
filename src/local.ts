import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { z } from "zod/v3";
import type { Backend, Sandbox } from "./sandbox.js";

const run = promisify(execFile);

async function sh(cwd: string, command: string, timeoutMs = 10 * 60_000) {
  try {
    const { stdout, stderr } = await run("bash", ["-lc", command], { cwd, timeout: timeoutMs, maxBuffer: 64 << 20, env: process.env });
    return { ok: true, output: stdout + stderr };
  } catch (e: any) {
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}` };
  }
}

/** Run `pi` with stdin closed (headless agents hang on an open stdin). */
function runPi(cwd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolveRun) => {
    const child = spawn("pi", args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ ok: code === 0, output });
    });
  });
}

export interface LocalOptions {
  /** Path to the source repo. It is cloned into a local bare "origin" so branches behave like GitHub. */
  repo: string;
  /** Existing node_modules to link into each checkout, so workers skip the install. */
  nodeModules: string;
  model?: string;
  /** "isolated" = one clone per worker (the Box model). "shared" = every worker edits the same checkout. */
  mode?: "isolated" | "shared";
}

/**
 * Dry-run backend: each sandbox is a separate clone in a temp directory and the agent is `pi` on Gemini.
 * It is NOT a security boundary (same user, same network). It exists to test the orchestration logic
 * without an Upstash account, and to reproduce the shared-checkout failure for comparison.
 */
export class LocalBackend implements Backend {
  readonly name: string;
  private root = "";
  private origin = "";
  private shared = "";

  constructor(private opts: LocalOptions) {
    this.name = `local-${opts.mode ?? "isolated"}`;
  }

  async prepare() {
    this.root = await mkdtemp(join(tmpdir(), "factory-"));
    this.origin = join(this.root, "origin.git");
    await sh(this.root, `git clone -q --bare "${this.opts.repo}" origin.git`);
    if (this.opts.mode === "shared") this.shared = await this.checkoutInto("shared");
  }

  private async checkoutInto(name: string) {
    const dir = join(this.root, name);
    await sh(this.root, `git clone -q "${this.origin}" "${name}" && cd "${name}" && git config user.name factory-bot && git config user.email bot@example.com && echo .factory >> .git/info/exclude`);
    await symlink(this.opts.nodeModules, join(dir, "node_modules"));
    return dir;
  }

  async sandbox(label: string): Promise<Sandbox> {
    const dir = this.opts.mode === "shared" ? this.shared : await this.checkoutInto(label);
    const model = this.opts.model ?? "gemini-3.8-flash";
    return {
      id: label,
      exec: (command) => sh(dir, command),
      agent: async <T>(prompt: string, schema: z.ZodType<T>, o: { timeoutMs?: number } = {}) => {
        // pi has no response-schema option, so the agent writes JSON to a file that we validate.
        const out = `.factory/${label}.json`;
        await mkdir(join(dir, ".factory"), { recursive: true });
        const full = `${prompt}\n\nWhen you are done, write your final report as a single JSON object to the file ${out} (create the directory if needed). Do not commit that file.`;
        let r = { ok: false, output: "" };
        for (let attempt = 0; attempt < 5; attempt++) {
          // Pass the prompt as an argument, never through a shell: prompts contain backticks and `$`.
          r = await runPi(dir, ["-p", "--provider", "google", "--model", model, full], o.timeoutMs ?? 20 * 60_000);
          const wrote = await readFile(join(dir, out), "utf8").then(() => true, () => false);
          // Gemini's per-minute quota: back off and let the agent continue in the same checkout.
          if (wrote || !/RESOURCE_EXHAUSTED|"code": 429|quota/i.test(r.output)) break;
          await new Promise((res) => setTimeout(res, 45_000 + Math.random() * 30_000));
        }
        // Validate the report; on a schema miss, give the agent the errors once and ask for a corrected file.
        // (Upstash Box enforces responseSchema itself; this reproduces that for the local backend.)
        for (let repair = 0; ; repair++) {
          let parsed: unknown;
          let problem = "";
          try {
            parsed = JSON.parse(await readFile(join(dir, out), "utf8"));
            const check = schema.safeParse(parsed);
            if (check.success) return { result: check.data, costUsd: 0, tokens: 0 };
            problem = JSON.stringify(check.error.issues);
          } catch {
            problem = `the file ${out} is missing or is not valid JSON`;
          }
          if (repair >= 1) throw new Error(`agent report invalid after repair: ${problem.slice(0, 300)}. Tail: ${r.output.slice(-200)}`);
          r = await runPi(dir, ["-p", "--provider", "google", "--model", model,
            `Your final report in ${out} does not match the required format: ${problem}\nRewrite ${out} so it matches exactly. Do not change any other file. The original task was:\n\n${prompt}`], 5 * 60_000);
        }
      },
      pushBranch: async (branch, message) => {
        const status = await sh(dir, `git status --porcelain`);
        if (!status.output.trim()) return false;
        const r = await sh(dir, `git checkout -q -B "${branch}" && git add -A && git commit -qm ${JSON.stringify(message)} && git push -q -f origin "${branch}"`);
        if (!r.ok) throw new Error(r.output);
        return true;
      },
      checkout: async (branch) => {
        const r = await sh(dir, `git fetch -q origin "${branch}" && git checkout -q -B "${branch}" FETCH_HEAD`);
        if (!r.ok) throw new Error(r.output);
      },
      openPR: async (branch) => `local:${branch}`,
      destroy: async () => {
        if (this.opts.mode !== "shared") await rm(dir, { recursive: true, force: true });
      },
    };
  }

  /** Where pushed branches live, for scoring afterwards. */
  get originPath() {
    return this.origin;
  }

  async cleanup() {
    // Keep origin.git (the "pull requests") for scoring; remove worker checkouts.
    await sh(this.root, `find . -mindepth 1 -maxdepth 1 ! -name origin.git -exec rm -rf {} +`);
  }
}
