import { IsoDateTime, ProviderKind, ServerProviderUsageLimits } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, PubSub, Schema, Stream } from "effect";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProviderUsageLimitsRepositoryError,
} from "../Errors.ts";
import {
  ProviderUsageLimitsRepository,
  type ProviderUsageLimitsRepositoryShape,
  StoredProviderUsageLimits,
} from "../Services/ProviderUsageLimits.ts";

const ProviderUsageLimitsDbRowSchema = Schema.Struct({
  provider: ProviderKind,
  updatedAt: IsoDateTime,
  usageLimits: Schema.fromJsonString(ServerProviderUsageLimits),
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProviderUsageLimitsRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProviderUsageLimitsRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<StoredProviderUsageLimits>(),
    PubSub.shutdown,
  );

  const upsertUsageLimitsRow = SqlSchema.void({
    Request: ProviderUsageLimitsDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO provider_usage_limits (
          provider_name,
          updated_at,
          payload_json
        )
        VALUES (
          ${row.provider},
          ${row.updatedAt},
          ${JSON.stringify(row.usageLimits)}
        )
        ON CONFLICT (provider_name)
        DO UPDATE SET
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `,
  });

  const getUsageLimitsByProvider = SqlSchema.findOneOption({
    Request: Schema.Struct({
      provider: ProviderKind,
    }),
    Result: ProviderUsageLimitsDbRowSchema,
    execute: ({ provider }) =>
      sql`
        SELECT
          provider_name AS "provider",
          updated_at AS "updatedAt",
          payload_json AS "usageLimits"
        FROM provider_usage_limits
        WHERE provider_name = ${provider}
      `,
  });

  const getByProvider: ProviderUsageLimitsRepositoryShape["getByProvider"] = (input) =>
    getUsageLimitsByProvider(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderUsageLimitsRepository.getByProvider:query",
          "ProviderUsageLimitsRepository.getByProvider:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Schema.decodeUnknownEffect(StoredProviderUsageLimits)(row).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  "ProviderUsageLimitsRepository.getByProvider:rowToUsageLimits",
                ),
              ),
              Effect.map(Option.some),
            ),
        }),
      ),
    );

  const upsert: ProviderUsageLimitsRepositoryShape["upsert"] = (input) => {
    const row: StoredProviderUsageLimits = {
      provider: input.provider,
      updatedAt: input.usageLimits.updatedAt,
      usageLimits: input.usageLimits,
    };

    return getByProvider({ provider: input.provider }).pipe(
      Effect.flatMap((existing) => {
        if (
          Option.isSome(existing) &&
          existing.value.updatedAt === row.updatedAt &&
          JSON.stringify(existing.value.usageLimits) === JSON.stringify(row.usageLimits)
        ) {
          return Effect.void;
        }

        return upsertUsageLimitsRow(row).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProviderUsageLimitsRepository.upsert:query",
              "ProviderUsageLimitsRepository.upsert:encodeRequest",
            ),
          ),
          Effect.tap(() => PubSub.publish(changesPubSub, row)),
          Effect.asVoid,
        );
      }),
    );
  };

  return {
    getByProvider,
    upsert,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ProviderUsageLimitsRepositoryShape;
});

export const ProviderUsageLimitsRepositoryLive = Layer.effect(
  ProviderUsageLimitsRepository,
  makeProviderUsageLimitsRepository,
);
