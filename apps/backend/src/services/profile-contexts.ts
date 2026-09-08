import { BrowShareError, createPublicId } from '@browshare/common'
import {
  assertProfileContextVariables,
  type ProfileContext,
  type SaveProfileContext,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, profiles, userProfileContexts, users } from '@browshare/database/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PolicyTransaction } from './session-policy-rules.js'

export function validateProfileContextVariables(
  variables: unknown,
): asserts variables is Record<string, unknown> {
  try {
    assertProfileContextVariables(variables)
  } catch (cause) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: (cause as Error).message,
    })
  }
}
async function target(tx: PolicyTransaction, profileId: string, userId: string, write: boolean) {
  const [profile] = await tx
    .select({ deleteRequestedAt: profiles.deleteRequestedAt })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
    .for(write ? 'update' : 'share')
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!profile || !user)
    throw new BrowShareError({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: 'Profile or user not found.',
    })
  if (write && profile.deleteRequestedAt !== null)
    throw new BrowShareError({
      code: 'CONFLICT',
      statusCode: 409,
      message: 'The Profile is being deleted.',
    })
}
export class ProfileContextService {
  constructor(private readonly connection: DatabaseConnection) {}
  async get(profileId: string, userId: string): Promise<ProfileContext> {
    return this.connection.db.transaction(async (tx) => {
      await target(tx, profileId, userId, false)
      const [row] = await tx
        .select()
        .from(userProfileContexts)
        .where(
          and(eq(userProfileContexts.profileId, profileId), eq(userProfileContexts.userId, userId)),
        )
      const variables = row?.variables ?? {}
      validateProfileContextVariables(variables)
      return { profileId, userId, variables, updatedAt: row?.updatedAt ?? null }
    })
  }
  async save(
    profileId: string,
    userId: string,
    input: SaveProfileContext,
    actor: { actorUserId: string; requestId: string },
  ): Promise<ProfileContext> {
    validateProfileContextVariables(input.variables)
    return this.connection.db.transaction(async (tx) => {
      await target(tx, profileId, userId, true)
      const [row] = await tx
        .insert(userProfileContexts)
        .values({
          id: createPublicId(),
          profileId,
          userId,
          variables: input.variables,
          updatedByUserId: actor.actorUserId,
        })
        .onConflictDoUpdate({
          target: [userProfileContexts.userId, userProfileContexts.profileId],
          set: {
            variables: input.variables,
            updatedByUserId: actor.actorUserId,
            updatedAt: sql`clock_timestamp()`,
          },
        })
        .returning()
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: actor.actorUserId,
        requestId: actor.requestId,
        action: 'profile.context.update',
        targetType: 'profile',
        targetId: profileId,
        result: 'SUCCEEDED',
        metadata: { userId },
        changes: {},
      })
      return { profileId, userId, variables: row!.variables, updatedAt: row!.updatedAt }
    })
  }
}
