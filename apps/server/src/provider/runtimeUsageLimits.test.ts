import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { parseRuntimeUsageLimitsUpdate } from "./runtimeUsageLimits.ts";

const CHECKED_AT = "2026-08-09T00:00:00.000Z";
const RESETS_AT_SECONDS = 1786752000;
const RESETS_AT_ISO = "2026-08-15T00:00:00.000Z";

const claudeDriver = ProviderDriverKind.make("claude");
const codexDriver = ProviderDriverKind.make("codex");
const grokDriver = ProviderDriverKind.make("grok");

describe("parseRuntimeUsageLimitsUpdate", () => {
  it("maps a Claude five-hour rate limit event onto the session window", () => {
    expect(
      parseRuntimeUsageLimitsUpdate({
        driverKind: claudeDriver,
        checkedAt: CHECKED_AT,
        rateLimits: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "five_hour",
            utilization: 42,
            resetsAt: RESETS_AT_SECONDS,
          },
        },
      }),
    ).toEqual({
      source: "claudeStatusProbe",
      windows: [
        { label: "Session", usedPercent: 42, windowDurationMins: 300, resetsAt: RESETS_AT_ISO },
      ],
    });
  });

  it("maps a Claude seven-day rate limit event onto the weekly window", () => {
    const update = parseRuntimeUsageLimitsUpdate({
      driverKind: claudeDriver,
      checkedAt: CHECKED_AT,
      rateLimits: {
        rate_limit_info: { status: "allowed_warning", rateLimitType: "seven_day", utilization: 88 },
      },
    });

    expect(update?.windows).toEqual([
      { label: "Weekly", usedPercent: 88, windowDurationMins: 10080 },
    ]);
  });

  it("ignores Claude sub-limits that have no bar of their own", () => {
    for (const rateLimitType of ["seven_day_opus", "seven_day_sonnet", "overage"]) {
      expect(
        parseRuntimeUsageLimitsUpdate({
          driverKind: claudeDriver,
          checkedAt: CHECKED_AT,
          rateLimits: { rate_limit_info: { rateLimitType, utilization: 10 } },
        }),
      ).toBeUndefined();
    }
  });

  it("returns undefined when a Claude event carries no utilization", () => {
    expect(
      parseRuntimeUsageLimitsUpdate({
        driverKind: claudeDriver,
        checkedAt: CHECKED_AT,
        rateLimits: { rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } },
      }),
    ).toBeUndefined();
  });

  it("reads a Codex rolling notification from its rateLimits envelope", () => {
    expect(
      parseRuntimeUsageLimitsUpdate({
        driverKind: codexDriver,
        checkedAt: CHECKED_AT,
        rateLimits: {
          rateLimits: {
            secondary: {
              usedPercent: 61,
              resetsAt: RESETS_AT_SECONDS,
              windowDurationMins: 10080,
            },
          },
        },
      }),
    ).toEqual({
      source: "codexAppServer",
      windows: [
        { label: "Weekly", usedPercent: 61, windowDurationMins: 10080, resetsAt: RESETS_AT_ISO },
      ],
    });
  });

  it("returns undefined for drivers without runtime rate-limit telemetry", () => {
    expect(
      parseRuntimeUsageLimitsUpdate({
        driverKind: grokDriver,
        checkedAt: CHECKED_AT,
        rateLimits: { rate_limit_info: { rateLimitType: "five_hour", utilization: 10 } },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for unusable payloads", () => {
    for (const rateLimits of [undefined, null, "nope", {}, []]) {
      expect(
        parseRuntimeUsageLimitsUpdate({
          driverKind: claudeDriver,
          checkedAt: CHECKED_AT,
          rateLimits,
        }),
      ).toBeUndefined();
    }
  });
});
