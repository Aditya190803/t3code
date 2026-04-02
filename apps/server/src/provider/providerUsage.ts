import type {
  ProviderKind,
  ServerProvider,
  ServerProviderUsage,
  ServerProviderUsageBucket,
  ServerProviderUsageBucketId,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): ReadonlyArray<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const records = value.map(asRecord);
  if (records.some((record) => record === null)) {
    return null;
  }

  return records as ReadonlyArray<Record<string, unknown>>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toBucketId(value: string | null): ServerProviderUsageBucketId | null {
  if (!value) {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "five_hour":
    case "fivehour":
    case "five-hour":
    case "5h":
    case "session":
    case "session_limit":
    case "session-limit":
      return "fiveHour";
    case "seven_day":
    case "sevenday":
    case "seven-day":
    case "weekly":
    case "weekly_limit":
    case "weekly-limit":
    case "7d":
      return "weekly";
    default:
      return null;
  }
}

function normalizePercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  const normalized = Math.max(0, Math.min(100, value));
  return Math.round(normalized * 1_000_000) / 1_000_000;
}

function normalizeUtilization(value: unknown): number | null {
  const utilization = asNumber(value);
  if (utilization === null) {
    return null;
  }

  const percent = Math.max(0, utilization * 100);
  return normalizePercent(percent);
}

function derivePercentFromUsage(usage: number | null, limit: number | null): number | null {
  if (usage === null) {
    return null;
  }

  if (limit !== null && limit > 0) {
    return normalizePercent((usage / limit) * 100);
  }

  return normalizePercent(usage);
}

/** @internal - Exported for testing */
export function deriveUsedPercentFromRemaining(
  remaining: number | null,
  limit: number | null,
): number | null {
  if (remaining === null) {
    return null;
  }

  if (limit !== null && limit > 0) {
    return normalizePercent(((limit - remaining) / limit) * 100);
  }

  return normalizePercent(100 - remaining);
}

function toIsoDateTime(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const epochMs = value > 1_000_000_000_000 ? value : value * 1_000;
  return new Date(epochMs).toISOString();
}

function usageBucketOrder(id: ServerProviderUsageBucketId): number {
  return id === "fiveHour" ? 0 : 1;
}

function sortBuckets(
  buckets: Iterable<ServerProviderUsageBucket>,
): ReadonlyArray<ServerProviderUsageBucket> {
  return [...buckets].toSorted(
    (left, right) => usageBucketOrder(left.id) - usageBucketOrder(right.id),
  );
}

function deriveRemainingPercent(
  usedPercent: number | null,
  remainingPercent: number | null,
): number | null {
  if (remainingPercent !== null) {
    return remainingPercent;
  }
  if (usedPercent === null) {
    return null;
  }
  return Math.max(0, 100 - usedPercent);
}

function toUsageBucketLabel(id: ServerProviderUsageBucketId): string {
  return id === "fiveHour" ? "Session limit" : "Weekly limit";
}

function getRecordValue(record: Record<string, unknown>, keys: ReadonlyArray<string>): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function makeUsageBucket(input: {
  id: ServerProviderUsageBucketId;
  label: string;
  resetsAt: unknown;
  usedPercent?: unknown;
  utilization?: unknown;
  remainingPercent?: unknown;
  remaining?: unknown;
  used?: unknown;
  usage?: unknown;
  limit?: unknown;
}): ServerProviderUsageBucket | null {
  const usedPercent =
    normalizePercent(asNumber(input.usedPercent)) ??
    normalizeUtilization(input.utilization) ??
    derivePercentFromUsage(asNumber(input.used), asNumber(input.limit)) ??
    derivePercentFromUsage(asNumber(input.usage), asNumber(input.limit));
  const derivedUsedPercentFromRemaining = deriveUsedPercentFromRemaining(
    normalizePercent(asNumber(input.remainingPercent)) ??
      normalizePercent(asNumber(input.remaining)),
    asNumber(input.limit),
  );
  const resolvedUsedPercent = usedPercent ?? derivedUsedPercentFromRemaining;
  const remainingPercent = deriveRemainingPercent(
    resolvedUsedPercent,
    normalizePercent(asNumber(input.remainingPercent)) ??
      normalizePercent(asNumber(input.remaining)),
  );
  const resetsAt = toIsoDateTime(input.resetsAt);

  if (resolvedUsedPercent === null || remainingPercent === null || !resetsAt) {
    return null;
  }

  return {
    id: input.id,
    label: input.label,
    usedPercent: resolvedUsedPercent,
    remainingPercent,
    resetsAt,
  };
}

function codexBucketIdFromWindow(value: unknown): ServerProviderUsageBucketId | null {
  const windowDurationMins = asNumber(value);
  if (windowDurationMins === 300) {
    return "fiveHour";
  }
  if (windowDurationMins === 10_080) {
    return "weekly";
  }
  return null;
}

function codexBucketIdFromWindowSeconds(value: unknown): ServerProviderUsageBucketId | null {
  const windowSeconds = asNumber(value);
  if (windowSeconds === 18_000) {
    return "fiveHour";
  }
  if (windowSeconds === 604_800) {
    return "weekly";
  }
  return null;
}

function codexBucketIdFromBucket(
  bucket: Record<string, unknown>,
  bucketKey?: string,
): ServerProviderUsageBucketId | null {
  return (
    toBucketId(
      asString(
        getRecordValue(bucket, ["id", "bucketId", "limitId", "rateLimitType", "rate_limit_type"]),
      ),
    ) ??
    toBucketId(bucketKey ? asString(bucketKey) : null) ??
    codexBucketIdFromWindowSeconds(
      getRecordValue(bucket, ["window_seconds", "windowSeconds", "windowDurationSecs"]),
    ) ??
    codexBucketIdFromWindow(
      getRecordValue(bucket, ["windowDurationMins", "windowDurationMinutes"]),
    ) ??
    toBucketId(asString(getRecordValue(bucket, ["label"])))
  );
}

function normalizeCodexUsageBuckets(rateLimits: Record<string, unknown>) {
  const buckets = new Map<ServerProviderUsageBucketId, ServerProviderUsageBucket>();
  const rateLimitsByLimitId = asRecord(
    getRecordValue(rateLimits, ["rateLimitsByLimitId", "rate_limits_by_limit_id"]),
  );
  const candidateBuckets: ReadonlyArray<{
    bucket: Record<string, unknown> | null;
    key?: string;
  }> = [
    { bucket: asRecord(getRecordValue(rateLimits, ["primary"])), key: "primary" },
    { bucket: asRecord(getRecordValue(rateLimits, ["secondary"])), key: "secondary" },
    ...Object.entries(rateLimitsByLimitId ?? {}).flatMap(([key, entry]) => {
      const bucket = asRecord(entry);
      return bucket ? [{ bucket, key }] : [];
    }),
  ];

  const resolvedCandidateBuckets = candidateBuckets.filter(
    (candidate): candidate is { bucket: Record<string, unknown>; key?: string } =>
      candidate.bucket !== null,
  );

  for (const { bucket, key } of resolvedCandidateBuckets) {
    const bucketId = codexBucketIdFromBucket(bucket, key);
    if (!bucketId) {
      continue;
    }
    const normalizedBucket = makeUsageBucket({
      id: bucketId,
      label: toUsageBucketLabel(bucketId),
      usedPercent: getRecordValue(bucket, ["usedPercent"]),
      utilization: getRecordValue(bucket, ["utilization"]),
      remainingPercent: getRecordValue(bucket, ["remainingPercent", "remaining"]),
      remaining: getRecordValue(bucket, ["remaining"]),
      used: getRecordValue(bucket, ["used"]),
      usage: getRecordValue(bucket, ["usage"]),
      limit: getRecordValue(bucket, ["limit"]),
      resetsAt: getRecordValue(bucket, ["resetsAt", "resetAt", "reset_at", "reset"]),
    });
    if (normalizedBucket) {
      buckets.set(bucketId, normalizedBucket);
    }
  }

  return sortBuckets(buckets.values());
}

function claudeBucketId(rateLimitType: string | null): ServerProviderUsageBucketId | null {
  switch (rateLimitType) {
    case "five_hour":
    case "session":
    case "session_limit":
      return "fiveHour";
    case "seven_day":
    case "seven_day_opus":
    case "seven_day_sonnet":
    case "weekly":
      return "weekly";
    default:
      return null;
  }
}

function normalizeClaudeUsageBuckets(
  rateLimits: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
) {
  let rateLimitInfos: ReadonlyArray<Record<string, unknown>>;
  if (Array.isArray(rateLimits)) {
    rateLimitInfos = rateLimits;
  } else {
    const resolvedRateLimits = rateLimits as Record<string, unknown>;
    const resolvedRateLimitInfo =
      asRecord(getRecordValue(resolvedRateLimits, ["rate_limit_info", "rateLimitInfo"])) ??
      resolvedRateLimits;
    rateLimitInfos = [resolvedRateLimitInfo];
  }
  const buckets = new Map<ServerProviderUsageBucketId, ServerProviderUsageBucket>();

  for (const rateLimitInfo of rateLimitInfos) {
    const resolvedRateLimitInfo =
      asRecord(getRecordValue(rateLimitInfo, ["rate_limit_info", "rateLimitInfo"])) ??
      rateLimitInfo;
    const rateLimitType = asString(
      getRecordValue(resolvedRateLimitInfo, ["rateLimitType", "rate_limit_type"]),
    );
    const bucketId = claudeBucketId(rateLimitType);
    if (!bucketId) {
      continue;
    }

    const bucket = makeUsageBucket({
      id: bucketId,
      label: toUsageBucketLabel(bucketId),
      utilization: getRecordValue(resolvedRateLimitInfo, ["utilization"]),
      remainingPercent: getRecordValue(resolvedRateLimitInfo, ["remainingPercent", "remaining"]),
      remaining: getRecordValue(resolvedRateLimitInfo, ["remaining"]),
      used: getRecordValue(resolvedRateLimitInfo, ["used"]),
      usage: getRecordValue(resolvedRateLimitInfo, ["usage"]),
      limit: getRecordValue(resolvedRateLimitInfo, ["limit"]),
      resetsAt: getRecordValue(resolvedRateLimitInfo, ["resetsAt", "resetAt", "reset_at"]),
    });

    if (bucket) {
      buckets.set(bucketId, bucket);
    }
  }

  return sortBuckets(buckets.values());
}

export function normalizeProviderUsageFromRateLimits(input: {
  provider: ProviderKind;
  rateLimits: unknown;
  updatedAt: string;
}): ServerProviderUsage | undefined {
  const rateLimits = asRecord(input.rateLimits);
  const rateLimitRecords = asRecordArray(input.rateLimits);
  if (!rateLimits && !rateLimitRecords) {
    return undefined;
  }

  const buckets =
    input.provider === "codex"
      ? (() => {
          if (!rateLimits) {
            return [];
          }

          const resolvedRateLimits =
            asRecord(getRecordValue(rateLimits, ["rateLimits", "rate_limits"])) ?? rateLimits;
          return normalizeCodexUsageBuckets(resolvedRateLimits);
        })()
      : normalizeClaudeUsageBuckets(rateLimitRecords ?? (rateLimits ? [rateLimits] : []));

  if (buckets.length === 0) {
    return undefined;
  }

  return {
    buckets,
    updatedAt: input.updatedAt,
  };
}

export function mergeProviderUsage(
  previous: ServerProviderUsage | undefined,
  next: ServerProviderUsage | undefined,
): ServerProviderUsage | undefined {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }

  const buckets = new Map<ServerProviderUsageBucketId, ServerProviderUsageBucket>();
  for (const bucket of previous.buckets) {
    buckets.set(bucket.id, bucket);
  }
  for (const bucket of next.buckets) {
    buckets.set(bucket.id, bucket);
  }

  const updatedAtCandidates = [previous.updatedAt, next.updatedAt].filter(
    (value): value is string => typeof value === "string",
  );

  return {
    buckets: sortBuckets(buckets.values()),
    ...(updatedAtCandidates.length > 0 ? { updatedAt: updatedAtCandidates.toSorted().at(-1) } : {}),
  };
}

export function applyUsageToProviderSnapshot(
  provider: ServerProvider,
  usage: ServerProviderUsage | undefined,
): ServerProvider {
  const mergedUsage = mergeProviderUsage(provider.usage, usage);
  if (!mergedUsage) {
    return provider;
  }

  return {
    ...provider,
    usage: mergedUsage,
  };
}
