import { describe, expect, it } from "vitest";

import {
  deriveUsedPercentFromRemaining,
  mergeProviderUsage,
  normalizeProviderUsageFromRateLimits,
} from "./providerUsage";

describe("providerUsage", () => {
  it("derives used percent from remaining values across edge cases", () => {
    expect(deriveUsedPercentFromRemaining(null, 100)).toBeNull();
    expect(deriveUsedPercentFromRemaining(0, 0)).toBe(100);
    expect(deriveUsedPercentFromRemaining(100, 0)).toBe(0);
    expect(deriveUsedPercentFromRemaining(100, null)).toBe(0);
    expect(deriveUsedPercentFromRemaining(100, 100)).toBe(0);
    expect(deriveUsedPercentFromRemaining(25, 100)).toBe(75);
  });

  it("normalizes Codex five-hour and weekly buckets from rate-limit payloads", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        rateLimitsByLimitId: {
          weekly: {
            limitId: "weekly",
            usage: 29,
            limit: 100,
            window_seconds: 604_800,
            reset_at: 1_775_555_565,
          },
          session: {
            limitId: "session",
            usage: 41,
            limit: 100,
            window_seconds: 18_000,
            reset_at: 1_775_123_456,
          },
        },
      },
    });

    expect(usage).toEqual({
      updatedAt: "2026-03-31T10:00:00.000Z",
      buckets: [
        {
          id: "fiveHour",
          label: "Session limit",
          remainingPercent: 59,
          usedPercent: 41,
          resetsAt: new Date(1_775_123_456_000).toISOString(),
        },
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 71,
          usedPercent: 29,
          resetsAt: new Date(1_775_555_565_000).toISOString(),
        },
      ],
    });
  });

  it("derives usedPercent from usage and limit when usage is an absolute count", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        rateLimitsByLimitId: {
          session: {
            limitId: "session",
            usage: 15,
            limit: 60,
            window_seconds: 18_000,
            reset_at: 1_775_123_456,
          },
        },
      },
    });

    expect(usage?.buckets).toEqual([
      {
        id: "fiveHour",
        label: "Session limit",
        remainingPercent: 75,
        usedPercent: 25,
        resetsAt: new Date(1_775_123_456_000).toISOString(),
      },
    ]);
  });

  it("normalizes Codex buckets when the payload reports used and remaining percentages", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        primary: {
          used: 3,
          remaining: 97,
          window_seconds: 18_000,
          reset_at: 1_775_123_456,
        },
        secondary: {
          used: 29,
          remaining: 71,
          window_seconds: 604_800,
          reset_at: 1_775_555_565,
        },
      },
    });

    expect(usage).toEqual({
      updatedAt: "2026-03-31T10:00:00.000Z",
      buckets: [
        {
          id: "fiveHour",
          label: "Session limit",
          remainingPercent: 97,
          usedPercent: 3,
          resetsAt: new Date(1_775_123_456_000).toISOString(),
        },
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 71,
          usedPercent: 29,
          resetsAt: new Date(1_775_555_565_000).toISOString(),
        },
      ],
    });
  });

  it("derives usedPercent from remaining when the payload only reports remaining percentages", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        primary: {
          remaining: 97,
          window_seconds: 18_000,
          reset_at: 1_775_123_456,
        },
      },
    });

    expect(usage?.buckets).toEqual([
      {
        id: "fiveHour",
        label: "Session limit",
        remainingPercent: 97,
        usedPercent: 3,
        resetsAt: new Date(1_775_123_456_000).toISOString(),
      },
    ]);
  });

  it("derives usedPercent from absolute remaining counts without clamping them as percentages", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        rateLimitsByLimitId: {
          session: {
            limitId: "session",
            remaining: 500,
            limit: 1_000,
            window_seconds: 18_000,
            reset_at: 1_775_123_456,
          },
        },
      },
    });

    expect(usage?.buckets).toEqual([
      {
        id: "fiveHour",
        label: "Session limit",
        remainingPercent: 50,
        usedPercent: 50,
        resetsAt: new Date(1_775_123_456_000).toISOString(),
      },
    ]);
  });

  it("does not double-scale low percentages derived from usage and limit", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "codex",
      updatedAt: "2026-03-31T10:00:00.000Z",
      rateLimits: {
        rateLimitsByLimitId: {
          session: {
            limitId: "session",
            usage: 1,
            limit: 1_000,
            window_seconds: 18_000,
            reset_at: 1_775_123_456,
          },
        },
      },
    });

    const bucket = usage?.buckets[0];
    expect(bucket?.usedPercent).toBeCloseTo(0.1, 6);
    expect(bucket?.remainingPercent).toBeCloseTo(99.9, 6);
  });

  it("normalizes Claude weekly rate-limit events", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "claudeAgent",
      updatedAt: "2026-03-31T10:05:00.000Z",
      rateLimits: {
        rate_limit_info: {
          rateLimitType: "seven_day",
          utilization: 0.42,
          resetsAt: 1_775_463_116,
        },
      },
    });

    expect(usage).toEqual({
      updatedAt: "2026-03-31T10:05:00.000Z",
      buckets: [
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 58,
          usedPercent: 42,
          resetsAt: new Date(1_775_463_116_000).toISOString(),
        },
      ],
    });
  });

  it("clamps over-limit utilization values to 100 percent", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "claudeAgent",
      updatedAt: "2026-03-31T10:06:00.000Z",
      rateLimits: {
        rate_limit_info: {
          rateLimitType: "seven_day",
          utilization: 1.5,
          resetsAt: 1_775_463_116,
        },
      },
    });

    expect(usage?.buckets).toEqual([
      {
        id: "weekly",
        label: "Weekly limit",
        remainingPercent: 0,
        usedPercent: 100,
        resetsAt: new Date(1_775_463_116_000).toISOString(),
      },
    ]);
  });

  it("normalizes Claude five-hour rate-limit events", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "claudeAgent",
      updatedAt: "2026-03-31T10:10:00.000Z",
      rateLimits: {
        rate_limit_info: {
          rate_limit_type: "five_hour",
          utilization: 0.15,
          reset_at: 1_775_123_456,
        },
      },
    });

    expect(usage).toEqual({
      updatedAt: "2026-03-31T10:10:00.000Z",
      buckets: [
        {
          id: "fiveHour",
          label: "Session limit",
          remainingPercent: 85,
          usedPercent: 15,
          resetsAt: new Date(1_775_123_456_000).toISOString(),
        },
      ],
    });
  });

  it("merges multiple Claude rate-limit snapshots into both buckets", () => {
    const usage = normalizeProviderUsageFromRateLimits({
      provider: "claudeAgent",
      updatedAt: "2026-03-31T10:15:00.000Z",
      rateLimits: [
        {
          rate_limit_info: {
            rateLimitType: "five_hour",
            utilization: 0.15,
            resetsAt: 1_775_123_456,
          },
        },
        {
          rate_limit_info: {
            rateLimitType: "seven_day",
            utilization: 0.42,
            resetsAt: 1_775_463_116,
          },
        },
      ],
    });

    expect(usage).toEqual({
      updatedAt: "2026-03-31T10:15:00.000Z",
      buckets: [
        {
          id: "fiveHour",
          label: "Session limit",
          remainingPercent: 85,
          usedPercent: 15,
          resetsAt: new Date(1_775_123_456_000).toISOString(),
        },
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 58,
          usedPercent: 42,
          resetsAt: new Date(1_775_463_116_000).toISOString(),
        },
      ],
    });
  });

  it("ignores malformed payloads", () => {
    expect(
      normalizeProviderUsageFromRateLimits({
        provider: "codex",
        updatedAt: "2026-03-31T10:05:00.000Z",
        rateLimits: {
          primary: {
            windowDurationMins: 10_080,
          },
        },
      }),
    ).toBeUndefined();
  });

  it("ignores partial payloads without enough data to derive a bucket", () => {
    expect(
      normalizeProviderUsageFromRateLimits({
        provider: "claudeAgent",
        updatedAt: "2026-03-31T10:05:00.000Z",
        rateLimits: {
          rate_limit_info: {
            rateLimitType: "seven_day",
          },
        },
      }),
    ).toBeUndefined();
  });

  it("merges incremental usage updates without dropping existing buckets", () => {
    const merged = mergeProviderUsage(
      {
        updatedAt: "2026-03-31T10:00:00.000Z",
        buckets: [
          {
            id: "fiveHour",
            label: "Session limit",
            remainingPercent: 80,
            usedPercent: 20,
            resetsAt: "2026-03-31T15:00:00.000Z",
          },
        ],
      },
      {
        updatedAt: "2026-03-31T10:05:00.000Z",
        buckets: [
          {
            id: "weekly",
            label: "Weekly limit",
            remainingPercent: 60,
            usedPercent: 40,
            resetsAt: "2026-04-06T10:00:00.000Z",
          },
        ],
      },
    );

    expect(merged).toEqual({
      updatedAt: "2026-03-31T10:05:00.000Z",
      buckets: [
        {
          id: "fiveHour",
          label: "Session limit",
          remainingPercent: 80,
          usedPercent: 20,
          resetsAt: "2026-03-31T15:00:00.000Z",
        },
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 60,
          usedPercent: 40,
          resetsAt: "2026-04-06T10:00:00.000Z",
        },
      ],
    });
  });
});
