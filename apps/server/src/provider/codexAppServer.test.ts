import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { probeCodexAccountState } from "./codexAppServer";

const tempDirs: Array<string> = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createCodexProbeStub(options: {
  readonly rateLimitsBehavior: "ignore" | "respond";
}): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-probe-stub-"));
  tempDirs.push(tempDir);

  const scriptPath = path.join(tempDir, "codex-stub.mjs");
  const respondsRateLimits = options.rateLimitsBehavior === "respond";
  const content = `#!/usr/bin/env node
import readline from "node:readline";

const output = (message) => {
  process.stdout.write(JSON.stringify(message) + "\\n");
};

const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    output({ id: 1, result: {} });
    return;
  }

  if (message.id === 2 && message.method === "account/read") {
    output({
      id: 2,
      result: {
        account: {
          type: "chatgpt",
          planType: "pro",
        },
      },
    });
    return;
  }

  if (message.id === 3 && message.method === "account/rateLimits/read") {
    if (${respondsRateLimits}) {
      output({
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
});
`;
  writeFileSync(scriptPath, content, { encoding: "utf8" });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("probeCodexAccountState", () => {
  it("resolves when account/rateLimits/read is ignored", async () => {
    const binaryPath = createCodexProbeStub({ rateLimitsBehavior: "ignore" });

    const state = await probeCodexAccountState({
      binaryPath,
      signal: AbortSignal.timeout(1_000),
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
    const binaryPath = createCodexProbeStub({ rateLimitsBehavior: "respond" });

    const state = await probeCodexAccountState({
      binaryPath,
      signal: AbortSignal.timeout(1_000),
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
