import { getProvider, LoginError, type LoginFailure, pkceLogin } from "@bochica/agent";
import type { LoginRequest } from "@bochica/shared";
import type { CredentialStore } from "./credentials";
import type { Logger } from "./logger";

type Login = typeof pkceLogin;

/** How a sign-in ended; IPC adds the updated key list to "ok". */
type LoginOutcome = { status: "ok" } | { status: LoginFailure | "busy" };

/**
 * Browser sign-ins, one at a time. The key a provider gives is saved like a pasted one; the
 * renderer only learns how the sign-in ended.
 */
export class LoginService {
  private running: AbortController | undefined;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly login: Login = pkceLogin,
  ) {}

  async start(request: LoginRequest): Promise<LoginOutcome> {
    const flow = getProvider(request.provider).login;
    if (!flow) throw new Error(`${getProvider(request.provider).label} has no sign-in.`);
    if (this.running) return { status: "busy" };
    const controller = new AbortController();
    this.running = controller;
    try {
      const key = await this.login({
        login: flow,
        page: request.page,
        signal: controller.signal,
        openBrowser: this.openBrowser,
      });
      this.credentials.add(request.provider, key, request.label);
      this.logger.info(`Signed in with ${request.provider}; a new key was saved`);
      return { status: "ok" };
    } catch (error) {
      if (!(error instanceof LoginError)) throw error;
      this.logger.info(`Sign-in with ${request.provider} ended: ${error.reason}`);
      return { status: error.reason };
    } finally {
      this.running = undefined;
    }
  }

  cancel(): void {
    this.running?.abort();
  }
}
