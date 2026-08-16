import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type ServerProviderUsageWindow } from "@t3tools/contracts";

import {
  collectQuotaGroups,
  formatUsageResetDate,
  getUsageWindowKey,
  shouldShowProviderQuota,
} from "./ProviderQuotaLimits";

describe("provider usage presentation", () => {
  it("omits malformed reset timestamps", () => {
    expect(formatUsageResetDate("not-a-date")).toBeNull();
    expect(formatUsageResetDate(undefined)).toBeNull();
  });

  it("formats a reset instant with the requested clock", () => {
    const resetAt = new Date(2026, 7, 16, 15, 30).toISOString();
    expect(formatUsageResetDate(resetAt, "24-hour")).toContain(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(resetAt)),
    );
  });

  it("uses the label to distinguish otherwise identical OpenCode windows", () => {
    const openCodeGo: ServerProviderUsageWindow = {
      kind: "session",
      label: "OpenCode Go",
      usedPercent: 10,
    };
    const openCodeZen: ServerProviderUsageWindow = {
      kind: "session",
      label: "OpenCode Zen",
      usedPercent: 50,
    };

    expect(getUsageWindowKey(openCodeGo)).not.toBe(getUsageWindowKey(openCodeZen));
  });
});

describe("shouldShowProviderQuota", () => {
  it("hides disabled providers and empty available snapshots", () => {
    expect(
      shouldShowProviderQuota({
        enabled: false,
        usageLimits: {
          source: "claudeStatusProbe",
          available: true,
          checkedAt: "2026-08-16T00:00:00.000Z",
          windows: [{ kind: "session", label: "Session", usedPercent: 10 }],
        },
      } as never),
    ).toBe(false);
    expect(
      shouldShowProviderQuota({
        enabled: true,
        usageLimits: {
          source: "claudeStatusProbe",
          available: true,
          checkedAt: "2026-08-16T00:00:00.000Z",
          windows: [],
        },
      } as never),
    ).toBe(false);
  });

  it("shows unavailable snapshots that have a reason", () => {
    expect(
      shouldShowProviderQuota({
        enabled: true,
        usageLimits: {
          source: "cursorStatusProbe",
          available: false,
          checkedAt: "2026-08-16T00:00:00.000Z",
          reason: "Could not read usage limits for this Cursor account.",
          windows: [],
        },
      } as never),
    ).toBe(true);
  });
});

describe("collectQuotaGroups", () => {
  it("omits environment labels when only one environment has quota data", () => {
    const environmentId = EnvironmentId.make("env-1");
    const groups = collectQuotaGroups(
      new Map([
        [
          environmentId,
          {
            providers: [
              {
                instanceId: "claude",
                driver: "claudeAgent",
                enabled: true,
                usageLimits: {
                  source: "claudeStatusProbe",
                  available: true,
                  checkedAt: "2026-08-16T00:00:00.000Z",
                  windows: [{ kind: "session", label: "Session", usedPercent: 10 }],
                },
              },
            ],
          } as never,
        ],
      ]),
      new Map([[environmentId, { entry: { target: { label: "Home" } } }]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.environmentLabel).toBeNull();
  });
});
