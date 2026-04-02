import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ServerProvider, ServerProviderUsage, ServerProviderUsageBucket } from "./server";

describe("server contracts", () => {
  it("decodes normalized provider usage buckets", () => {
    const bucket = Schema.decodeUnknownSync(ServerProviderUsageBucket)({
      id: "fiveHour",
      label: "Session limit",
      remainingPercent: 63,
      usedPercent: 37,
      resetsAt: "2026-03-31T12:00:00.000Z",
    });

    expect(bucket.id).toBe("fiveHour");
    expect(bucket.remainingPercent).toBe(63);
  });

  it("decodes provider usage payloads", () => {
    const usage = Schema.decodeUnknownSync(ServerProviderUsage)({
      updatedAt: "2026-03-31T10:00:00.000Z",
      buckets: [
        {
          id: "weekly",
          label: "Weekly limit",
          remainingPercent: 58,
          usedPercent: 42,
          resetsAt: "2026-04-06T05:12:45.000Z",
        },
      ],
    });

    expect(usage.buckets).toHaveLength(1);
    expect(usage.buckets[0]?.id).toBe("weekly");
  });

  it("allows usage on server providers", () => {
    const provider = Schema.decodeUnknownSync(ServerProvider)({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "0.117.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-03-31T10:00:00.000Z",
      usage: {
        updatedAt: "2026-03-31T10:00:00.000Z",
        buckets: [
          {
            id: "weekly",
            label: "Weekly limit",
            remainingPercent: 58,
            usedPercent: 42,
            resetsAt: "2026-04-06T05:12:45.000Z",
          },
        ],
      },
      models: [],
    });

    expect(provider.usage?.buckets[0]?.label).toBe("Weekly limit");
  });
});
