import type { z } from "zod/v3";

/** What the factory needs from a sandbox. Upstash Box and the local dry-run backend both implement it. */
export interface Sandbox {
  readonly id: string;
  /** Run a shell command in the repo directory. */
  exec(command: string): Promise<{ ok: boolean; output: string }>;
  /** Run the coding agent and return output that matches the schema. */
  agent<T>(prompt: string, schema: z.ZodType<T>, opts?: { maxBudgetUsd?: number; timeoutMs?: number; onTool?: (name: string, input: Record<string, unknown>) => void }): Promise<{ result: T; costUsd: number; tokens: number }>;
  /** Commit everything and push it as a new branch. Returns false when there was nothing to commit. */
  pushBranch(branch: string, message: string): Promise<boolean>;
  /** Check out a branch that another sandbox pushed. */
  checkout(branch: string): Promise<void>;
  /** Open a pull request for a pushed branch. Returns its URL, or the branch name for the local backend. */
  openPR(branch: string, title: string, body: string): Promise<string>;
  destroy(): Promise<void>;
}

export interface Backend {
  readonly name: string;
  /** Build the base environment once (clone + install) so workers start from a known good state. */
  prepare(): Promise<void>;
  /** A fresh, isolated sandbox restored from the prepared base. */
  sandbox(label: string): Promise<Sandbox>;
  cleanup(): Promise<void>;
}
