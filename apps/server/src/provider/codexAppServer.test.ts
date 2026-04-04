import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
    spawnSync: vi.fn(),
  };
});

import { probeCodexAccountState } from "./codexAppServer";

type RateLimitsBehavior = "ignore" | "respond" | "respondWithLimitId";

function createMockCodexProbeChild(
  rateLimitsBehavior: RateLimitsBehavior,
): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;

  let killed = false;
  let stdinBuffer = "";

  const writeResponse = (message: unknown) => {
    stdout.write(`${JSON.stringify(message)}\n`);
  };

  const finish = () => {
    stdout.end();
    stderr.end();
    emitter.emit("close", 0, null);
  };

  Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: 1234,
    get killed() {
      return killed;
    },
    kill: () => {
      killed = true;
      finish();
      return true;
    },
  });

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    stdinBuffer += chunk;

    let newlineIndex = stdinBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = stdinBuffer.slice(0, newlineIndex).trim();
      stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
      newlineIndex = stdinBuffer.indexOf("\n");
      if (!line) {
        continue;
      }

      const message = JSON.parse(line) as { id?: number; method?: string };

      if (message.method === "initialize") {
        writeResponse({ id: 1, result: {} });
        continue;
      }

      if (message.id === 2 && message.method === "account/read") {
        writeResponse({
          id: 2,
          result: {
            account: {
              type: "chatgpt",
              planType: "pro",
            },
          },
        });
        continue;
      }

      if (message.id === 3 && message.method === "account/rateLimits/read") {
        if (rateLimitsBehavior === "respond") {
          writeResponse({
            id: 3,
            result: {
              rateLimits: {
                primary: {
                  usedPercent: 72.5,
                  windowDurationMins: 300,
                  resetsAt: 1730947200,
                },
                secondary: {
                  usedPercent: 35,
                  windowDurationMins: 10080,
                  resetsAt: 1731000000,
                },
              },
            },
          });
        } else if (rateLimitsBehavior === "respondWithLimitId") {
          writeResponse({
            id: 3,
            result: {
              rateLimits: {
                primary: {
                  usedPercent: 11,
                  windowDurationMins: 300,
                  resetsAt: 1730947200,
                },
              },
              rateLimitsByLimitId: {
                codex: {
                  primary: {
                    usedPercent: 27,
                    windowDurationMins: 10080,
                    resetsAt: 1731000000,
                  },
                },
              },
            },
          });
        }

        queueMicrotask(finish);
      }
    }
  });

  return emitter;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("probeCodexAccountState", () => {
  it("resolves when account/rateLimits/read is ignored", async () => {
    spawnMock.mockImplementation(() => createMockCodexProbeChild("ignore"));

    const state = await probeCodexAccountState({
      binaryPath: "codex",
      signal: AbortSignal.timeout(2_500),
    });

    expect(state.snapshot).toEqual({
      type: "chatgpt",
      planType: "pro",
      sparkEnabled: true,
    });
    expect(state.account).toEqual({
      account: {
        type: "chatgpt",
        planType: "pro",
      },
    });
    expect(state.rateLimits).toBeNull();
  });

  it("includes rate limits when account/rateLimits/read responds", async () => {
    spawnMock.mockImplementation(() => createMockCodexProbeChild("respond"));

    const state = await probeCodexAccountState({
      binaryPath: "codex",
      signal: AbortSignal.timeout(1_000),
    });

    expect(state.snapshot).toEqual({
      type: "chatgpt",
      planType: "pro",
      sparkEnabled: true,
    });
    expect(state.rateLimits).toEqual({
      rateLimits: {
        primary: {
          usedPercent: 72.5,
          windowDurationMins: 300,
          resetsAt: 1730947200,
        },
        secondary: {
          usedPercent: 35,
          windowDurationMins: 10080,
          resetsAt: 1731000000,
        },
      },
    });
  });

  it("preserves top-level rateLimitsByLimitId payloads from account/rateLimits/read", async () => {
    spawnMock.mockImplementation(() => createMockCodexProbeChild("respondWithLimitId"));

    const state = await probeCodexAccountState({
      binaryPath: "codex",
      signal: AbortSignal.timeout(1_000),
    });

    expect(state.rateLimits).toEqual({
      rateLimits: {
        primary: {
          usedPercent: 11,
          windowDurationMins: 300,
          resetsAt: 1730947200,
        },
      },
      rateLimitsByLimitId: {
        codex: {
          primary: {
            usedPercent: 27,
            windowDurationMins: 10080,
            resetsAt: 1731000000,
          },
        },
      },
    });
  });
});
