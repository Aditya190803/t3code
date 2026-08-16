import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModel, ServerProviderUsageWindow } from "@t3tools/contracts";

import {
  deriveProviderModelsForDisplay,
  formatUsageResetDate,
  getUsageWindowKey,
} from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: ["kept-custom"],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });
});

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
