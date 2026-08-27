import type { ServerProvider, ServerProviderUsageLimits } from "@t3tools/contracts";

import {
  providerQuotaLabel,
  providerQuotaNotice,
  shouldShowProviderQuota,
} from "../usage/ProviderQuotaLimits";

export type ComposerUsageMeterModel = {
  readonly providerLabel: string;
  readonly usageLimits: ServerProviderUsageLimits;
  readonly usedPercent: number;
};

export function headlineUsageUsedPercent(windows: ServerProviderUsageLimits["windows"]): number {
  if (windows.length === 0) return 0;
  return Math.max(...windows.map((window) => window.usedPercent));
}

/**
 * Composer usage is opt-in and scoped to the thread's current provider.
 * Unavailable, unpaid, or empty snapshots stay hidden so the chat box
 * never renders an error state next to send.
 */
export function resolveComposerUsageMeter(input: {
  readonly enabled: boolean;
  readonly provider: ServerProvider | null | undefined;
}): ComposerUsageMeterModel | null {
  if (!input.enabled) return null;
  const provider = input.provider;
  if (!provider || !shouldShowProviderQuota(provider)) return null;
  if (providerQuotaNotice(provider) !== null) return null;

  const usageLimits = provider.usageLimits;
  if (!usageLimits?.available || usageLimits.windows.length === 0) return null;

  return {
    providerLabel: providerQuotaLabel(provider),
    usageLimits,
    usedPercent: headlineUsageUsedPercent(usageLimits.windows),
  };
}
