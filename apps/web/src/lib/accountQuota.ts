import type {
  ServerProvider,
  ServerProviderUsageBucket,
  TimestampFormat,
} from "@t3tools/contracts";
import { getTimestampFormatOptions } from "../timestampFormat";

export function getProviderUsageBuckets(
  provider: ServerProvider | null | undefined,
): ReadonlyArray<ServerProviderUsageBucket> {
  return provider?.usage?.buckets ?? [];
}

export function formatUsageRemainingPercent(bucket: ServerProviderUsageBucket): string {
  const rounded = Number.isInteger(bucket.remainingPercent)
    ? bucket.remainingPercent
    : Number(bucket.remainingPercent.toFixed(1));
  return `${rounded}% remaining`;
}

const usageResetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getUsageResetFormatter(timestampFormat: TimestampFormat): Intl.DateTimeFormat {
  const cached = usageResetFormatterCache.get(timestampFormat);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...getTimestampFormatOptions(timestampFormat, false),
  });
  usageResetFormatterCache.set(timestampFormat, formatter);
  return formatter;
}

export function formatUsageResetAt(isoDate: string, timestampFormat: TimestampFormat): string {
  return `Resets ${getUsageResetFormatter(timestampFormat).format(new Date(isoDate))}`;
}
