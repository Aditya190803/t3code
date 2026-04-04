import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt } from "./baseSchemas";

export const ServerProviderUsageWindowKind = Schema.Literals(["session", "weekly"]);
export type ServerProviderUsageWindowKind = typeof ServerProviderUsageWindowKind.Type;

const UsedPercentage = NonNegativeInt.check(Schema.isLessThanOrEqualTo(100));

const SessionUsageWindow = Schema.Struct({
  kind: Schema.Literal("session"),
  label: Schema.Literal("Session limit"),
  usedPercentage: UsedPercentage,
  resetsAt: IsoDateTime,
  windowDurationMins: Schema.NullOr(NonNegativeInt),
});

const WeeklyUsageWindow = Schema.Struct({
  kind: Schema.Literal("weekly"),
  label: Schema.Literal("Weekly limit"),
  usedPercentage: UsedPercentage,
  resetsAt: IsoDateTime,
  windowDurationMins: Schema.NullOr(NonNegativeInt),
});

export const ServerProviderUsageWindow = Schema.Union([SessionUsageWindow, WeeklyUsageWindow]);
export type ServerProviderUsageWindow = typeof ServerProviderUsageWindow.Type;

export const ServerProviderUsageLimits = Schema.Struct({
  windows: Schema.Array(ServerProviderUsageWindow),
  updatedAt: IsoDateTime,
});
export type ServerProviderUsageLimits = typeof ServerProviderUsageLimits.Type;
