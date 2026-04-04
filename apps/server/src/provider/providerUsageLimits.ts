import type {
  ProviderKind,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  ServerProviderUsageWindowKind,
} from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { ProviderUsageLimitsRepository } from "../persistence/Services/ProviderUsageLimits.ts";

const SESSION_WINDOW_DURATION_MINS = 300;
const WEEKLY_WINDOW_DURATION_MINS = 10_080;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampUsedPercentage(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  if (number === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function readUnixSecondsAsIso(value: unknown): string | undefined {
  const unixSeconds = asFiniteNumber(value);
  if (unixSeconds === undefined) return undefined;
  return new Date(unixSeconds * 1000).toISOString();
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function readIsoDateTime(value: unknown): string | undefined {
  return readUnixSecondsAsIso(value) ?? readIsoDate(value);
}

function readWindowDurationMins(
  record: Record<string, unknown>,
  fallback: number | null,
): number | null {
  const duration =
    asFiniteNumber(record.windowDurationMins) ??
    asFiniteNumber(record.window_duration_mins) ??
    asFiniteNumber(record.windowMins) ??
    asFiniteNumber(record.window_minutes);
  if (duration === undefined) {
    return fallback;
  }
  return Math.max(0, Math.round(duration));
}

function createUsageWindow(input: {
  readonly kind: ServerProviderUsageWindowKind;
  readonly usedPercentage: unknown;
  readonly resetsAt: unknown;
  readonly windowDurationMins: number | null;
}): ServerProviderUsageWindow | undefined {
  const usedPercentage = clampUsedPercentage(input.usedPercentage);
  const resetsAt = readIsoDateTime(input.resetsAt);

  if (usedPercentage === undefined || resetsAt === undefined) {
    return undefined;
  }

  if (input.kind === "session") {
    return {
      kind: "session",
      label: "Session limit",
      usedPercentage,
      resetsAt,
      windowDurationMins: input.windowDurationMins,
    };
  }

  return {
    kind: "weekly",
    label: "Weekly limit",
    usedPercentage,
    resetsAt,
    windowDurationMins: input.windowDurationMins,
  };
}

function buildUsageLimits(
  windows: ReadonlyArray<ServerProviderUsageWindow | undefined>,
  updatedAt: string,
): ServerProviderUsageLimits | undefined {
  const normalizedUpdatedAt = readIsoDateTime(updatedAt);
  if (!normalizedUpdatedAt) {
    return undefined;
  }

  const resolvedWindows = windows.flatMap((window) => (window ? [window] : []));
  if (resolvedWindows.length === 0) {
    return undefined;
  }

  return {
    updatedAt: normalizedUpdatedAt,
    windows: resolvedWindows.toSorted((left, right) =>
      left.kind === right.kind ? 0 : left.kind === "session" ? -1 : 1,
    ),
  };
}

function inferCodexWindowKind(
  name: string,
  record: Record<string, unknown>,
): ServerProviderUsageWindowKind | undefined {
  const normalizedName = name.toLowerCase();
  const windowDurationMins = readWindowDurationMins(record, null);

  if (windowDurationMins === SESSION_WINDOW_DURATION_MINS) return "session";
  if (windowDurationMins === WEEKLY_WINDOW_DURATION_MINS) return "weekly";

  if (normalizedName.includes("session") || normalizedName.includes("primary")) {
    return "session";
  }
  if (
    normalizedName.includes("week") ||
    normalizedName.includes("secondary") ||
    normalizedName.includes("seven")
  ) {
    return "weekly";
  }

  return undefined;
}

function normalizeCodexWindow(name: string, value: unknown): ServerProviderUsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const kind = inferCodexWindowKind(name, record);
  if (!kind) return undefined;

  return createUsageWindow({
    kind,
    usedPercentage: record.usedPercent ?? record.used_percentage ?? record.percentage,
    resetsAt: record.resetsAt ?? record.resets_at ?? record.resetAt ?? record.reset_at,
    windowDurationMins: readWindowDurationMins(
      record,
      kind === "session" ? SESSION_WINDOW_DURATION_MINS : WEEKLY_WINDOW_DURATION_MINS,
    ),
  });
}

function getPreferredCodexRateLimitsRoot(rateLimits: unknown): Record<string, unknown> | undefined {
  const root = asRecord(rateLimits);
  if (!root) return undefined;

  const rateLimitsByLimitId = asRecord(root.rateLimitsByLimitId);
  const preferred = asRecord(rateLimitsByLimitId?.codex);
  if (preferred) {
    return preferred;
  }

  return asRecord(root.rateLimits) ?? root;
}

export function normalizeCodexUsageLimits(
  rateLimits: unknown,
  updatedAt: string,
): ServerProviderUsageLimits | undefined {
  const root = getPreferredCodexRateLimitsRoot(rateLimits);
  if (!root) return undefined;

  return buildUsageLimits(
    [
      normalizeCodexWindow("primary", root.primary),
      normalizeCodexWindow("secondary", root.secondary),
    ],
    updatedAt,
  );
}

function getClaudeRateLimitsRoot(rateLimits: unknown): Record<string, unknown> | undefined {
  const root = asRecord(rateLimits);
  if (!root) return undefined;
  return asRecord(root.rate_limits) ?? asRecord(root.rateLimits) ?? root;
}

function normalizeClaudeWindow(
  value: unknown,
  input: {
    readonly kind: ServerProviderUsageWindowKind;
    readonly defaultDurationMins: number;
  },
): ServerProviderUsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return createUsageWindow({
    kind: input.kind,
    usedPercentage: record.used_percentage ?? record.usedPercent ?? record.percentage,
    resetsAt: record.resets_at ?? record.resetsAt ?? record.reset_at ?? record.resetAt,
    windowDurationMins: readWindowDurationMins(record, input.defaultDurationMins),
  });
}

export function normalizeClaudeUsageLimits(
  rateLimits: unknown,
  updatedAt: string,
): ServerProviderUsageLimits | undefined {
  const root = getClaudeRateLimitsRoot(rateLimits);
  if (!root) return undefined;

  return buildUsageLimits(
    [
      normalizeClaudeWindow(root.five_hour ?? root.fiveHour, {
        kind: "session",
        defaultDurationMins: SESSION_WINDOW_DURATION_MINS,
      }),
      normalizeClaudeWindow(root.seven_day ?? root.sevenDay, {
        kind: "weekly",
        defaultDurationMins: WEEKLY_WINDOW_DURATION_MINS,
      }),
    ],
    updatedAt,
  );
}

export const readPersistedProviderUsageLimits = Effect.fn("readPersistedProviderUsageLimits")(
  function* (provider: ProviderKind, repository: typeof ProviderUsageLimitsRepository.Service) {
    const stored = yield* repository.getByProvider({ provider });
    return Option.getOrUndefined(stored)?.usageLimits;
  },
);
