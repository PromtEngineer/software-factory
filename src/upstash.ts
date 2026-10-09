import { Agent, Box, ClaudeCode } from "@upstash/box";
import type { z } from "zod/v3";
import type { Backend, Sandbox } from "./sandbox.js";

export interface UpstashOptions {
  repo: string;            // e.g. "github.com/you/tinylinks"
  githubToken: string;
  model?: string;          // defaults to Claude Sonnet 5 on the Upstash-provided key (Opus 5.5 and Fable 5.1 also available)
  llmApiKey?: string;      // omit to use the LLM budget Upstash includes with the plan
  size?: "small" | "medium" | "large";
  /**
   * Restrict worker egress to an allowlist. Off by default until the smoke test confirms which
   * domain the built-in agent uses to reach its model (the Upstash-provided key may use a gateway).
   */
  egressAllowlist?: string[];
  /**
   * Ground the agents with Context7 Search: a `docs "<question>"` command in every box that returns
   * current official docs. The key is attached to context7.com requests from outside the container,
   * so the agent never sees it. Without a key, Context7 serves keyless requests (rate-limited by IP).
   */
  context7?: { apiKey?: string };
}

/** `docs "<question>" [library hint ...]`: Context7 Search from inside a box. Every query is logged. */
export const DOCS_SCRIPT = `#!/usr/bin/env bash
# docs "<question>" [library ...]  ->  current official documentation from Context7 Search
q="$1"; shift
args=(--data-urlencode "query=$q")
for l in "$@"; do args+=(--data-urlencode "library=$l"); done
printf '%s\\t%s\\n' "$(date -u +%H:%M:%S)" "$q\${*:+ [$*]}" >> /workspace/home/docs-queries.log
curl -sG --max-time 30 https://context7.com/api/v3/search "\${args[@]}"
`;

/** One Upstash Box per worker, all restored from one prepared snapshot. */
export class UpstashBackend implements Backend {
  readonly name = "upstash-box";
  private snapshotId?: string;
  private base?: Box;
  private live = new Set<Box>();

  constructor(private opts: UpstashOptions) {}

  private config(label: string) {
    return {
      runtime: "node" as const,
      size: this.opts.size ?? "small",
      name: label,
      labels: ["factory"],
      git: { token: this.opts.githubToken, userName: "factory-bot", userEmail: "factory-bot@users.noreply.github.com" },
      agent: {
        harness: Agent.ClaudeCode,
        model: (this.opts.model ?? ClaudeCode.Sonnet_5) as ClaudeCode,
        ...(this.opts.llmApiKey ? { apiKey: this.opts.llmApiKey } : {}),
      },
      ...(this.opts.egressAllowlist
        ? { networkPolicy: { mode: "custom" as const, allowedDomains: [...this.opts.egressAllowlist, ...(this.opts.context7 ? ["context7.com"] : [])] } }
        : {}),
      ...(this.opts.context7?.apiKey ? { attachHeaders: { "context7.com": { Authorization: `Bearer ${this.opts.context7.apiKey}` } } } : {}),
    };
  }

  async prepare() {
    this.base = await Box.create(this.config("factory-base"));
    await this.base.git.clone({ repo: this.opts.repo, branch: "main" });
    const dir = this.opts.repo.split("/").pop()!;
    await this.base.cd(dir);
    if (this.opts.context7) {
      await this.base.files.write({ path: "/workspace/home/bin/docs", content: DOCS_SCRIPT });
      await this.base.exec.command("chmod +x /workspace/home/bin/docs && (ln -sf /workspace/home/bin/docs /usr/local/bin/docs 2>/dev/null || true)");
    }
    const install = await this.base.exec.command("npm ci --no-audit --no-fund");
    if (install.status !== "completed") throw new Error(`install failed: ${install.result}`);
    this.snapshotId = (await this.base.snapshot({ name: "factory-base" })).id;
  }

  async sandbox(label: string): Promise<Sandbox> {
    if (!this.snapshotId) throw new Error("call prepare() first");
    const box = await Box.fromSnapshot(this.snapshotId, this.config(label));
    this.live.add(box);
    const dir = this.opts.repo.split("/").pop()!;
    await box.cd(dir);
    return {
      id: box.id,
      exec: async (command) => {
        const r = await box.exec.command(command);
        return { ok: r.status === "completed", output: r.result };
      },
      agent: async (prompt, schema, o = {}) => {
        const run = await box.agent.run({
          prompt,
          responseSchema: schema as z.ZodType<any>,
          options: { maxBudgetUsd: o.maxBudgetUsd ?? 2, maxTurns: 60 },
          timeout: o.timeoutMs ?? 30 * 60_000,
          ...(o.onTool ? { onToolUse: (t: { name: string; input: Record<string, unknown> }) => o.onTool!(t.name, t.input) } : {}),
        });
        return { result: run.result as any, costUsd: run.cost?.totalUsd ?? 0, tokens: (run.cost?.inputTokens ?? 0) + (run.cost?.outputTokens ?? 0) };
      },
      pushBranch: async (branch, message) => {
        await box.git.exec({ args: ["checkout", "-B", branch] });
        const status = await box.git.status();
        if (!String(status).trim() || /nothing to commit/.test(String(status))) return false;
        await box.git.commit({ message });
        await box.git.push({ branch });
        return true;
      },
      checkout: async (branch) => {
        await box.git.exec({ args: ["fetch", "origin", branch] });
        await box.git.exec({ args: ["checkout", "-B", branch, "FETCH_HEAD"] });
      },
      openPR: async (branch, title, body) => (await box.git.createPR({ title, body, base: "main" })).url,
      destroy: async () => {
        this.live.delete(box);
        await box.delete();
      },
    };
  }

  async cleanup() {
    await Promise.allSettled([...this.live].map((b) => b.delete()));
    if (this.base) {
      if (this.snapshotId) await this.base.deleteSnapshot(this.snapshotId).catch(() => {});
      await this.base.delete().catch(() => {});
    }
  }
}
