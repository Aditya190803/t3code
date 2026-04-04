import { describe, expect, it } from "vitest";

import { normalizeClaudeUsageLimits, normalizeCodexUsageLimits } from "./providerUsageLimits";

describe("normalizeCodexUsageLimits", () => {
  it("returns weekly-only limits for free-tier style payloads", () => {
    const usageLimits = normalizeCodexUsageLimits(
      {
        rateLimits: {
          primary: {
            usedPercent: 42,
            windowDurationMins: 10_080,
            resetsAt: 1_762_050_000,
          },
          secondary: null,
        },
      },
      "2026-04-04T00:00:00.000Z",
    );

    expect(usageLimits).toEqual({
      updatedAt: "2026-04-04T00:00:00.000Z",
      windows: [
        {
          kind: "weekly",
          label: "Weekly limit",
          usedPercentage: 42,
          resetsAt: new Date(1_762_050_000 * 1000).toISOString(),
          windowDurationMins: 10_080,
        },
      ],
    });
  });

  it("returns session and weekly limits for dual-window payloads", () => {
    const usageLimits = normalizeCodexUsageLimits(
      {
        rateLimits: {
          primary: {
            usedPercent: 73.6,
            windowDurationMins: 300,
            resetsAt: 1_762_040_000,
          },
          secondary: {
            usedPercent: 12,
            windowDurationMins: 10_080,
            resetsAt: 1_762_090_000,
          },
        },
      },
      "2026-04-04T00:00:00.000Z",
    );

    expect(usageLimits?.windows).toEqual([
      {
        kind: "session",
        label: "Session limit",
        usedPercentage: 74,
        resetsAt: new Date(1_762_040_000 * 1000).toISOString(),
        windowDurationMins: 300,
      },
      {
        kind: "weekly",
        label: "Weekly limit",
        usedPercentage: 12,
        resetsAt: new Date(1_762_090_000 * 1000).toISOString(),
        windowDurationMins: 10_080,
      },
    ]);
  });

  it("prefers rateLimitsByLimitId.codex over fallback rateLimits", () => {
    const usageLimits = normalizeCodexUsageLimits(
      {
        rateLimits: {
          primary: {
            usedPercent: 10,
            windowDurationMins: 300,
            resetsAt: 1_762_010_000,
          },
        },
        rateLimitsByLimitId: {
          codex: {
            primary: {
              usedPercent: 66,
              windowDurationMins: 300,
              resetsAt: 1_762_020_000,
            },
          },
        },
      },
      "2026-04-04T00:00:00.000Z",
    );

    expect(usageLimits?.windows[0]).toEqual({
      kind: "session",
      label: "Session limit",
      usedPercentage: 66,
      resetsAt: new Date(1_762_020_000 * 1000).toISOString(),
      windowDurationMins: 300,
    });
  });
});

describe("normalizeClaudeUsageLimits", () => {
  it("normalizes statusline-shaped Claude runtime payloads", () => {
    const usageLimits = normalizeClaudeUsageLimits(
      {
        type: "rate_limit_event",
        rate_limits: {
          five_hour: {
            used_percentage: 91.2,
            resets_at: 1_762_030_000,
          },
          seven_day: {
            used_percentage: 17,
            resets_at: 1_762_100_000,
          },
        },
      },
      "2026-04-04T00:00:00.000Z",
    );

    expect(usageLimits?.windows).toEqual([
      {
        kind: "session",
        label: "Session limit",
        usedPercentage: 91,
        resetsAt: new Date(1_762_030_000 * 1000).toISOString(),
        windowDurationMins: 300,
      },
      {
        kind: "weekly",
        label: "Weekly limit",
        usedPercentage: 17,
        resetsAt: new Date(1_762_100_000 * 1000).toISOString(),
        windowDurationMins: 10_080,
      },
    ]);
  });
});
