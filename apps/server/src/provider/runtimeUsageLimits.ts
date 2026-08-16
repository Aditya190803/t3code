/**
 * Runtime usage-limit telemetry — turns `account.rate-limits.updated` payloads
 * into usage windows.
 *
 * Claude and Codex both push rate-limit updates over their session runtime
 * while a turn is streaming, which is fresher than the periodic status probes
 * and costs nothing extra to read. The payloads are declared `Schema.Unknown`
 * on the wire (`AccountRateLimitsUpdatedPayload`), so everything here is
 * structural parsing with a `undefined` result for anything unrecognized.
 *
 * @module provider/runtimeUsageLimits
 */
import type { ProviderDriverKind, ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  resolveCodexRateLimitSnapshotUsageLimits,
  type CodexRateLimitSnapshot,
} from "./codexUsageProbe.ts";
import type { RawUsageWindowInput } from "./providerUsageLimits.ts";

/**
 * Claude reports each limit window separately. Only the two windows Settings
 * renders are mapped: the `*_opus` / `*_sonnet` weekly sub-limits and `overage`
 * would all collapse onto the same "weekly" slot and fight over it.
 */
const CLAUDE_WINDOW_BY_RATE_LIMIT_TYPE: Readonly<
  Record<string, { readonly label: string; readonly windowDurationMins: number }>
> = {
  five_hour: { label: "Session", windowDurationMins: 5 * 60 },
  seven_day: { label: "Weekly", windowDurationMins: 7 * 24 * 60 },
};

export interface RuntimeUsageLimitsUpdate {
  readonly source: ServerProviderUsageLimits["source"];
  readonly windows: ReadonlyArray<RawUsageWindowInput>;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Both CLIs report resets as epoch *seconds*, but a millisecond value would
 * decode as a date ~50000 years out rather than failing, so scale anything
 * already large enough to be milliseconds.
 */
function epochToIso(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }
  const millis = value > 1e12 ? value : value * 1000;
  return DateTime.formatIso(DateTime.makeUnsafe(millis));
}

export function parseClaudeRuntimeUsageWindows(
  rateLimits: unknown,
): ReadonlyArray<RawUsageWindowInput> {
  const event = readRecord(rateLimits);
  const info = readRecord(event?.rate_limit_info) ?? event;
  const rateLimitType = typeof info?.rateLimitType === "string" ? info.rateLimitType : undefined;
  const window = rateLimitType ? CLAUDE_WINDOW_BY_RATE_LIMIT_TYPE[rateLimitType] : undefined;
  const utilization = readFiniteNumber(info?.utilization);
  if (!window || utilization === undefined) {
    return [];
  }

  const resetsAt = epochToIso(readFiniteNumber(info?.resetsAt));
  return [
    {
      label: window.label,
      usedPercent: utilization,
      windowDurationMins: window.windowDurationMins,
      ...(resetsAt ? { resetsAt } : {}),
    },
  ];
}

export function parseCodexRuntimeUsageWindows(
  rateLimits: unknown,
  checkedAt: string,
): ReadonlyArray<RawUsageWindowInput> {
  const payload = readRecord(rateLimits);
  // The adapter forwards the notification verbatim, so the snapshot may be the
  // payload itself or sit under its `rateLimits` key.
  const snapshot = readRecord(payload?.rateLimits) ?? payload;
  if (!snapshot) {
    return [];
  }

  // Reuse the probe's window resolution so a rolling notification and a full
  // `account/rateLimits/read` produce identical windows, then project back to
  // raw inputs for the shared normalizer.
  const resolved = resolveCodexRateLimitSnapshotUsageLimits({
    checkedAt,
    snapshot: snapshot as CodexRateLimitSnapshot,
  });
  if (!resolved.available) {
    return [];
  }

  return resolved.windows.map((window) => ({
    label: window.label,
    usedPercent: window.usedPercent,
    ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
    ...(window.windowDurationMins !== undefined
      ? { windowDurationMins: window.windowDurationMins }
      : {}),
  }));
}

/**
 * Map an `account.rate-limits.updated` payload onto usage windows for the
 * driver that emitted it. Returns `undefined` when the driver has no runtime
 * rate-limit telemetry or the payload carries nothing usable — callers keep
 * the previous snapshot in that case.
 */
export function parseRuntimeUsageLimitsUpdate(input: {
  readonly driverKind: ProviderDriverKind;
  readonly rateLimits: unknown;
  readonly checkedAt: string;
}): RuntimeUsageLimitsUpdate | undefined {
  const { windows, source } =
    input.driverKind === "claude"
      ? {
          windows: parseClaudeRuntimeUsageWindows(input.rateLimits),
          source: "claudeStatusProbe" as const,
        }
      : input.driverKind === "codex"
        ? {
            windows: parseCodexRuntimeUsageWindows(input.rateLimits, input.checkedAt),
            source: "codexAppServer" as const,
          }
        : { windows: [], source: "codexAppServer" as const };

  return windows.length > 0 ? { source, windows } : undefined;
}
