import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from "./codexAccount";

interface JsonRpcProbeResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === "string" ? response.error.message : undefined;
}

function readCodexRateLimitsSnapshot(response: unknown): unknown | null {
  return response ?? null;
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

export interface CodexAccountState {
  readonly snapshot: CodexAccountSnapshot;
  readonly account: unknown | null;
  readonly rateLimits: unknown | null;
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
    let completed = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let accountResult: unknown | undefined;
    let rateLimitsResult: unknown | null | undefined;
    let handleAbort: (() => void) | undefined;
    let stdoutBuffer = "";

    const cleanup = () => {
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer);
      }
      if (handleAbort) {
        input.signal?.removeEventListener("abort", handleAbort);
      }
      child.stdout.removeAllListeners();
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

    if (input.signal?.aborted) {
      fail(new Error("Codex account probe aborted."));
      return;
    }
    handleAbort = () => fail(new Error("Codex account probe aborted."));
    input.signal?.addEventListener("abort", handleAbort);

    const maybeResolve = () => {
      if (accountResult === undefined) {
        return;
      }

      if (rateLimitsResult !== undefined) {
        finish(() =>
          resolve({
            snapshot: readCodexAccountSnapshot(accountResult),
            account: accountResult ?? null,
            rateLimits: rateLimitsResult,
          }),
        );
        return;
      }

      if (settleTimer !== undefined) {
        return;
      }

      settleTimer = setTimeout(() => {
        rateLimitsResult = null;
        maybeResolve();
      }, 150);
    };

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }

      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const processOutputLine = (line: string) => {
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
      if (response.id === 1) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }

        writeMessage({ method: "initialized" });
        writeMessage({ id: 2, method: "account/read", params: {} });
        writeMessage({ id: 3, method: "account/rateLimits/read", params: {} });
        return;
      }

      if (response.id === 2) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`account/read failed: ${errorMessage}`));
          return;
        }

        accountResult = response.result ?? null;
        maybeResolve();
        return;
      }

      if (response.id === 3) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          rateLimitsResult = null;
          maybeResolve();
          return;
        }

        rateLimitsResult = readCodexRateLimitsSnapshot(response.result);
        maybeResolve();
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          processOutputLine(line);
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (completed) return;
      const trailingLine = stdoutBuffer.trim();
      if (trailingLine.length > 0) {
        stdoutBuffer = "";
        processOutputLine(trailingLine);
        if (completed) return;
      }
      if (accountResult !== undefined) {
        rateLimitsResult = rateLimitsResult ?? null;
        maybeResolve();
        return;
      }
      fail(
        new Error(
          `codex app-server exited before probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}
