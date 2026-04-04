import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { ProviderUsageLimitsRepository } from "../Services/ProviderUsageLimits.ts";
import { ProviderUsageLimitsRepositoryLive } from "./ProviderUsageLimits.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProviderUsageLimitsRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProviderUsageLimitsRepository", (it) => {
  it.effect("keeps the newest usage limits snapshot when a stale update arrives", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderUsageLimitsRepository;
      const newerUsageLimits = {
        updatedAt: "2026-04-04T01:00:00.000Z",
        windows: [
          {
            kind: "weekly" as const,
            label: "Weekly limit",
            usedPercentage: 31,
            resetsAt: "2026-04-08T00:00:00.000Z",
            windowDurationMins: 10_080,
          },
        ],
      } satisfies ServerProviderUsageLimits;
      const staleUsageLimits = {
        updatedAt: "2026-04-04T00:00:00.000Z",
        windows: [
          {
            kind: "weekly" as const,
            label: "Weekly limit",
            usedPercentage: 12,
            resetsAt: "2026-04-09T00:00:00.000Z",
            windowDurationMins: 10_080,
          },
        ],
      } satisfies ServerProviderUsageLimits;

      yield* repository.upsert({
        provider: "codex",
        usageLimits: newerUsageLimits,
      });

      yield* repository.upsert({
        provider: "codex",
        usageLimits: staleUsageLimits,
      });

      const stored = yield* repository.getByProvider({ provider: "codex" });
      assert.equal(Option.isSome(stored), true);
      if (Option.isSome(stored)) {
        assert.deepStrictEqual(stored.value.usageLimits, newerUsageLimits);
        assert.strictEqual(stored.value.updatedAt, newerUsageLimits.updatedAt);
      }
    }),
  );
});
