import { BrowShareError } from '@browshare/common'
import type { DatabaseConnection } from '@browshare/database'
import { profiles, tabSessions, users } from '@browshare/database/schema'
import { and, eq, sql } from 'drizzle-orm'
import { authorized } from './gateways.js'

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

/** Same lock order as access revocation; ownership is required even for administrators. */
export async function lockAuthorizedSession(tx: Transaction, userId: string, sessionId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(28691, 1)`)
  const [owner] = await tx
    .select({ profileId: tabSessions.profileId })
    .from(tabSessions)
    .where(and(eq(tabSessions.id, sessionId), eq(tabSessions.userId, userId)))
  if (!owner)
    throw new BrowShareError({
      code: 'NOT_FOUND',
      message: 'Session does not exist.',
      statusCode: 404,
    })
  await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, owner.profileId))
    .for('update')
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
  const [session] = await tx
    .select()
    .from(tabSessions)
    .where(eq(tabSessions.id, sessionId))
    .for('update')
  if (!session || !(await authorized(tx, userId, owner.profileId, session.kind)))
    throw new BrowShareError({
      code: 'PROFILE_NOT_ACCESSIBLE',
      message: 'Session authorization is no longer available.',
      statusCode: 403,
    })
  return session
}
