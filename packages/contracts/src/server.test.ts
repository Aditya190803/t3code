import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ServerProvider } from "./server";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("accepts providers without usage limits", () => {
    const parsed = decodeServerProvider({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.2.3",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-03-31T10:00:00.000Z",
      models: [],
    });

    expect(parsed.usageLimits).toBeUndefined();
  });

  it("accepts normalized usage limits", () => {
    const parsed = decodeServerProvider({
      provider: "claudeAgent",
      enabled: true,
      installed: true,
      version: "0.9.0",
      status: "ready",
      auth: { status: "authenticated", type: "max", label: "Claude Max Subscription" },
      checkedAt: "2026-03-31T10:00:00.000Z",
      models: [],
      usageLimits: {
        updatedAt: "2026-03-31T10:02:00.000Z",
        windows: [
          {
            kind: "session",
            label: "Session limit",
            usedPercentage: 72,
            resetsAt: "2026-03-31T15:00:00.000Z",
            windowDurationMins: 300,
          },
          {
            kind: "weekly",
            label: "Weekly limit",
            usedPercentage: 35,
            resetsAt: "2026-04-01T00:00:00.000Z",
            windowDurationMins: 10080,
          },
        ],
      },
    });

    expect(parsed.usageLimits?.windows).toHaveLength(2);
    expect(parsed.usageLimits?.windows[0]?.kind).toBe("session");
    expect(parsed.usageLimits?.windows[1]?.kind).toBe("weekly");
  });

  it("rejects malformed usage-limit percentages", () => {
    expect(() =>
      decodeServerProvider({
        provider: "codex",
        enabled: true,
        installed: true,
        version: "1.2.3",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-03-31T10:00:00.000Z",
        models: [],
        usageLimits: {
          updatedAt: "2026-03-31T10:02:00.000Z",
          windows: [
            {
              kind: "weekly",
              label: "Weekly limit",
              usedPercentage: 101,
              resetsAt: "2026-04-01T00:00:00.000Z",
              windowDurationMins: 10080,
            },
          ],
        },
      }),
    ).toThrow();
  });
});
