import { describe, expect, it } from "vitest";
import type { ServerProvider } from "@t3tools/contracts";

import {
  formatUsageRemainingPercent,
  formatUsageResetAt,
  getProviderUsageBuckets,
} from "./accountQuota";

function makeProvider(
  input: Partial<ServerProvider> & Pick<ServerProvider, "provider">,
): ServerProvider {
  return {
    enabled: true,
    installed: true,
    version: "0.117.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-03-30T00:00:00.000Z",
    models: [],
    ...input,
  };
}

describe("accountQuota", () => {
  it("returns provider usage buckets in normalized order", () => {
    const buckets = getProviderUsageBuckets(
      makeProvider({
        provider: "codex",
        usage: {
          buckets: [
            {
              id: "fiveHour",
              label: "Session limit",
              remainingPercent: 67,
              usedPercent: 33,
              resetsAt: "2026-04-01T05:30:00.000Z",
            },
            {
              id: "weekly",
              label: "Weekly limit",
              remainingPercent: 71,
              usedPercent: 29,
              resetsAt: "2026-04-06T05:12:45.000Z",
            },
          ],
          updatedAt: "2026-03-31T10:00:00.000Z",
        },
      }),
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.id).toBe("fiveHour");
    expect(buckets[1]?.id).toBe("weekly");
  });

  it("formats compact remaining percentages", () => {
    expect(
      formatUsageRemainingPercent({
        id: "weekly",
        label: "Weekly limit",
        remainingPercent: 58,
        usedPercent: 42,
        resetsAt: "2026-04-06T05:12:45.000Z",
      }),
    ).toBe("58% remaining");
  });

  it("formats reset timestamps using the selected time format", () => {
    expect(formatUsageResetAt("2026-04-06T17:05:00.000Z", "24-hour")).not.toMatch(/[AP]M/);
    expect(formatUsageResetAt("2026-04-06T17:05:00.000Z", "12-hour")).toMatch(/[AP]M/);
  });

  it("returns an empty list when usage is unavailable", () => {
    expect(getProviderUsageBuckets(makeProvider({ provider: "claudeAgent" }))).toEqual([]);
  });
});
