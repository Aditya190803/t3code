import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

import { probeCodexAccountState } from "./codexAppServer";

interface StubOptions {
  readonly rateLimitsBehavior: "ignore" | "respond";
}

function installCodexProbeChild(options: StubOptions) {
  spawnMock.mockImplementation(() => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      killed: boolean;
      pid: number;
      kill: () => void;
    };

    let inputBuffer = "";
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.killed = false;
    child.pid = 1234;
    child.kill = () => {
      child.killed = true;
      child.emit("exit", null, null);
    };

    const writeJson = (value: unknown) => {
      stdout.write(`${JSON.stringify(value)}\n`);
    };

    stdin.on("data", (chunk: Buffer | string) => {
      inputBuffer += chunk.toString();
      let newlineIndex = inputBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = inputBuffer.slice(0, newlineIndex).trim();
        inputBuffer = inputBuffer.slice(newlineIndex + 1);
        if (line.length === 0) {
          newlineIndex = inputBuffer.indexOf("\n");
          continue;
        }

        const message = JSON.parse(line) as { id?: number; method?: string };
        if (message.method === "initialize") {
          writeJson({ id: 1, result: {} });
        } else if (message.id === 2 && message.method === "account/read") {
          writeJson({
            id: 2,
            result: {
              account: {
                type: "chatgpt",
                planType: "pro",
              },
            },
          });
        } else if (message.id === 3 && message.method === "account/rateLimits/read") {
          if (options.rateLimitsBehavior === "respond") {
            writeJson({
              id: 3,
              result: {
                rateLimits: {
                  primary: {
                    remaining: 7,
                    used: 3,
                  },
                },
              },
            });
          }
        }

        newlineIndex = inputBuffer.indexOf("\n");
      }
    });

    return child;
  });
}

afterEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
});

describe("probeCodexAccountState", () => {
  it("resolves when account/rateLimits/read is ignored", async () => {
    installCodexProbeChild({ rateLimitsBehavior: "ignore" });

    const state = await probeCodexAccountState({
      binaryPath: "codex",
      signal: AbortSignal.timeout(3_000),
    });

    expect(state.snapshot).toEqual({
      type: "chatgpt",
      planType: "pro",
      sparkEnabled: true,
    });
    expect(state.account).toEqual({
      type: "chatgpt",
      planType: "pro",
    });
    expect(state.rateLimits).toBeNull();
  });

  it("includes rate limits when account/rateLimits/read responds", async () => {
    installCodexProbeChild({ rateLimitsBehavior: "respond" });

    const state = await probeCodexAccountState({
      binaryPath: "codex",
      signal: AbortSignal.timeout(3_000),
    });

    expect(state.snapshot).toEqual({
      type: "chatgpt",
      planType: "pro",
      sparkEnabled: true,
    });
    expect(state.rateLimits).toEqual({
      primary: {
        remaining: 7,
        used: 3,
      },
    });
  });
});
