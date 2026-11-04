import {
  claudeCodeEnv,
  claudeCodeRun,
  type ClaudeCodeSetup,
  claudeCodeSignedIn,
  findClaudeCode,
  listClaudeModels,
} from "@bochica/agent";
import type { ConnectionResult, ModelInfo } from "@bochica/shared";

type ClaudeRun = ReturnType<typeof claudeCodeRun>;

/**
 * Claude Agent's side in main: finds the user's Claude Code each time it is needed (it may be
 * installed or signed in while Bochica runs) and never handles its login.
 */
export class ClaudeCodeService {
  constructor(
    private readonly env: Record<string, string | undefined>,
    /** Bochica's name and version, for Claude Code's User-Agent. */
    private readonly app: string,
    /** Where Claude Code starts; it has no file tools. */
    private readonly cwd: string,
  ) {}

  private setup(): ClaudeCodeSetup | undefined {
    const executable = findClaudeCode(this.env);
    return executable
      ? { executable, env: claudeCodeEnv(this.env, this.app), cwd: this.cwd }
      : undefined;
  }

  /** What Settings → Test shows. */
  async status(): Promise<ConnectionResult> {
    const setup = this.setup();
    if (!setup) return { status: "not_installed" };
    try {
      return (await claudeCodeSignedIn(setup)) ? { status: "ok" } : { status: "signed_out" };
    } catch {
      return { status: "error", httpStatus: 0 };
    }
  }

  /** Claude Code's models for the signed-in plan; none when it isn't installed or signed in. */
  async models(): Promise<ModelInfo[]> {
    const setup = this.setup();
    if (!setup || !(await claudeCodeSignedIn(setup).catch(() => false))) return [];
    return listClaudeModels(setup);
  }

  /** How a turn's model runs Claude Code; undefined when it isn't installed. */
  run(): ClaudeRun | undefined {
    const setup = this.setup();
    return setup ? claudeCodeRun(setup) : undefined;
  }
}
