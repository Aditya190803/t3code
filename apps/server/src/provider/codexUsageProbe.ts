import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  makeUnavailableUsageLimits,
  makeUsageLimitsSnapshot,
  type RawUsageWindowInput,
} from "./providerUsageLimits.ts";

const CODEX_SESSION_WINDOW_DURATION_MINS = 300; // ~5 hours (short / session window)
const CODEX_WEEKLY_WINDOW_DURATION_MINS = 10080; // 7 days (weekly window)

const UNAVAILABLE_REASON = "No Codex subscription quota windows reported.";

/** Minimal structural view of a Codex rate-limit window. */
export interface CodexRateLimitWindow {
  readonly usedPercent: number;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

/** Minimal structural view of a Codex rate-limit snapshot. */
export interface CodexRateLimitSnapshot {
  readonly primary?: CodexRateLimitWindow | null;
  readonly secondary?: CodexRateLimitWindow | null;
}

export function resolveCodexRateLimitSnapshotUsageLimits(input: {
  readonly checkedAt: string;
  readonly snapshot?: CodexRateLimitSnapshot | null;
}): ServerProviderUsageLimits {
  if (!input.snapshot) {
    return makeUnavailableUsageLimits({
      source: "codexAppServer",
      checkedAt: input.checkedAt,
      reason: UNAVAILABLE_REASON,
    });
  }

  const reported = [input.snapshot.primary, input.snapshot.secondary].filter(
    (window): window is CodexRateLimitWindow =>
      Boolean(window) && Number.isFinite(window?.usedPercent),
  );

  // `primary`/`secondary` are positions, not durations. Codex dropped the
  // 5-hour session limit and now reports the weekly limit alone, so assuming
  // "primary means session" rendered that weekly window under a "Session"
  // label with a fabricated 5-hour duration. Trust the reported
  // `windowDurationMins`, fall back to the positional meaning only when both
  // windows are present (the older two-limit accounts), and treat a lone
  // duration-less window as the weekly limit. Labels are left empty so
  // `normalizeUsageWindows` names each bar after the kind it resolves to.
  const windows: RawUsageWindowInput[] = reported.map((window, index) => {
    const durationMins =
      typeof window.windowDurationMins === "number"
        ? window.windowDurationMins
        : reported.length > 1 && index === 0
          ? CODEX_SESSION_WINDOW_DURATION_MINS
          : CODEX_WEEKLY_WINDOW_DURATION_MINS;
    return {
      label: "",
      usedPercent: window.usedPercent,
      windowDurationMins: durationMins,
      ...(typeof window.resetsAt === "number"
        ? { resetsAt: DateTime.formatIso(DateTime.makeUnsafe(window.resetsAt * 1000)) }
        : {}),
    };
  });

  return makeUsageLimitsSnapshot({
    source: "codexAppServer",
    checkedAt: input.checkedAt,
    windows,
    unavailableReason: UNAVAILABLE_REASON,
  });
}
