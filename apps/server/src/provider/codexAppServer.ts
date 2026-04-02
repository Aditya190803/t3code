import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import {
  readCodexAccountPayload,
  readCodexAccountSnapshot,
  readCodexRateLimitsPayload,
  type CodexAccountSnapshot,
} from "./codexAccount";

export interface CodexAccountState {
  readonly snapshot: CodexAccountSnapshot;
  readonly account: Record<string, unknown> | null;
  readonly rateLimits: Record<string, unknown> | null;
}

interface JsonRpcProbeResponse {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

const RATE_LIMITS_PROBE_GRACE_MS = 300;
const EXIT_GRACE_MS = 50;

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === "string" ? response.error.message : undefined;
}

export function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const;
}

export function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to direct kill when taskkill is unavailable.
    }
  }

  child.kill();
}

export async function probeCodexAccount(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexAccountSnapshot> {
  const state = await probeCodexAccountState(input);
  return state.snapshot;
}

export async function probeCodexAccountState(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexAccountState> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ["app-server"], {
      env: {
        ...process.env,
        ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const output = readline.createInterface({ input: child.stdout });

    let completed = false;
    let accountSnapshot: CodexAccountSnapshot | null = null;
    let accountPayload: Record<string, unknown> | null = null;
    let rateLimitsPayload: Record<string, unknown> | null | undefined;
    let rateLimitsFallbackTimer: NodeJS.Timeout | undefined;
    let rateLimitsRequestedAt: number | null = null;

    const cleanup = () => {
      if (rateLimitsFallbackTimer) {
        clearTimeout(rateLimitsFallbackTimer);
        rateLimitsFallbackTimer = undefined;
      }
      output.removeAllListeners();
      output.close();
      child.removeAllListeners();
      if (!child.killed) {
        killCodexChildProcess(child);
      }
    };

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      cleanup();
      callback();
    };

    const fail = (error: unknown) =>
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error(`Codex account probe failed: ${String(error)}.`),
        ),
      );

    const maybeFinish = () => {
      if (!accountSnapshot) {
        return;
      }

      if (rateLimitsPayload === undefined) {
        if (rateLimitsRequestedAt === null) {
          return;
        }

        if (!rateLimitsFallbackTimer) {
          const remainingGraceMs = Math.max(
            0,
            RATE_LIMITS_PROBE_GRACE_MS - (Date.now() - rateLimitsRequestedAt),
          );
          rateLimitsFallbackTimer = setTimeout(() => {
            rateLimitsPayload = null;
            maybeFinish();
          }, remainingGraceMs);
        }
        return;
      }

      const snapshot = accountSnapshot;
      const account = accountPayload ?? null;
      const rateLimits = rateLimitsPayload;

      finish(() =>
        resolve({
          snapshot,
          account,
          rateLimits,
        }),
      );
    };

    if (input.signal?.aborted) {
      fail(new Error("Codex account probe aborted."));
      return;
    }
    input.signal?.addEventListener("abort", () => fail(new Error("Codex account probe aborted.")));

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }

      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    output.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail(new Error("Received invalid JSON from codex app-server during account probe."));
        return;
      }

      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const response = parsed as JsonRpcProbeResponse;
      if (response.method === "account/rateLimits/updated") {
        const payload =
          readCodexRateLimitsPayload(response.params) ??
          readCodexRateLimitsPayload(response.result);
        rateLimitsPayload = payload ?? null;
        maybeFinish();
        return;
      }

      if (response.id === 1) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }

        writeMessage({ method: "initialized" });
        writeMessage({ id: 2, method: "account/read", params: {} });
        rateLimitsRequestedAt = Date.now();
        writeMessage({ id: 3, method: "account/rateLimits/read", params: {} });
        return;
      }

      if (response.id === 2) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`account/read failed: ${errorMessage}`));
          return;
        }

        accountSnapshot = readCodexAccountSnapshot(response.result);
        accountPayload = readCodexAccountPayload(response.result) ?? null;
        maybeFinish();
        return;
      }

      if (response.id === 3) {
        const payload = readCodexRateLimitsPayload(response.result);
        if (payload) {
          rateLimitsPayload = payload;
        }
        maybeFinish();
      }
    });

    child.once("error", fail);
    child.once("exit", (code, signal) => {
      setTimeout(() => {
        if (completed) return;
        if (accountSnapshot) {
          rateLimitsPayload ??= null;
          maybeFinish();
          if (completed) {
            return;
          }
        }
        fail(
          new Error(
            `codex app-server exited before probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
          ),
        );
      }, EXIT_GRACE_MS);
    });

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}
