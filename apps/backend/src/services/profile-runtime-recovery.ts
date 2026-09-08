import type { DatabaseConnection } from '@browshare/database'
import { profiles } from '@browshare/database/schema'
import { and, eq, lt, sql } from 'drizzle-orm'

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

/** Caller holds the Profile row lock. A result and a snapshot may report the same failure. */
export async function recordProfileRuntimeFailure(
  tx: Transaction,
  profileId: string,
  generation: number,
): Promise<void> {
  await tx
    .update(profiles)
    .set({
      runtimeFailureGeneration: generation,
      runtimeFailureCount: sql`${profiles.runtimeFailureCount} + 1`,
      runtimeHealthySince: null,
      runtimeRetryAt: sql`case when ${profiles.runtimeFailureCount} + 1 >= 5 then null else clock_timestamp() + (5 * power(2, ${profiles.runtimeFailureCount})) * interval '1 second' end`,
    })
    .where(
      and(
        eq(profiles.id, profileId),
        eq(profiles.runtimeGeneration, generation),
        lt(profiles.runtimeFailureGeneration, generation),
      ),
    )
}
