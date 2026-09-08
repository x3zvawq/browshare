import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  normalizePageLimit,
} from '@browshare/common'
import type {
  NavigationPolicyVersion,
  NavigationPolicyPreviewRequest,
  PageQuery,
  SaveNavigationPolicyDraft,
} from '@browshare/contracts'
import {
  compileNavigationPolicy,
  validateNavigationPolicyScript,
  NavigationPolicyError,
} from '@browshare/navigation-policy'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  navigationPolicyVersions,
  profilePublications,
  profiles,
} from '@browshare/database/schema'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PolicyTransaction } from './session-policy-rules.js'

type Reader = DatabaseConnection['db'] | PolicyTransaction
type VersionRow = typeof navigationPolicyVersions.$inferSelect
type AuditContext = { actorUserId: string; requestId: string }
function fail(code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND', message: string): never {
  throw new BrowShareError({
    code,
    message,
    statusCode: code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 400,
  })
}
async function profile(db: Reader, id: string, lock?: 'share' | 'update') {
  const query = db
    .select({ id: profiles.id, name: profiles.name, deleteRequestedAt: profiles.deleteRequestedAt })
    .from(profiles)
    .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
  const [row] = await (lock ? query.for(lock) : query)
  if (!row) fail('NOT_FOUND', 'Profile not found.')
  if (lock === 'update' && row.deleteRequestedAt !== null)
    fail('CONFLICT', 'The Profile is being deleted.')
  return { id: row.id, name: row.name }
}
function version(row: VersionRow): NavigationPolicyVersion {
  return {
    id: row.id,
    profileId: row.profileId,
    version: row.version,
    state: row.state,
    ruleCount: row.rules.length,
    hasScript: row.policyScript !== null,
    changeSummary: row.changeSummary,
    createdAt: new Date(row.createdAt).toISOString(),
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    disabledAt: row.disabledAt ? new Date(row.disabledAt).toISOString() : null,
    content: {
      rules: [...row.rules],
      defaultAction: row.defaultAction as 'ALLOW_REMOTE' | 'DENY',
      policyScript: row.policyScript,
    },
  }
}
function compile(input: SaveNavigationPolicyDraft['content']) {
  try {
    return compileNavigationPolicy(input)
  } catch (cause) {
    if (cause instanceof NavigationPolicyError)
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: cause.message,
        ...(cause.ruleId ? { details: { ruleId: cause.ruleId } } : {}),
      })
    throw cause
  }
}
async function readVersion(db: Reader, profileId: string, id: string) {
  const [row] = await db
    .select()
    .from(navigationPolicyVersions)
    .where(
      and(eq(navigationPolicyVersions.profileId, profileId), eq(navigationPolicyVersions.id, id)),
    )
  if (!row) fail('NOT_FOUND', 'Navigation Policy version not found.')
  return row
}
async function audit(
  tx: PolicyTransaction,
  context: AuditContext,
  profileId: string,
  action: string,
  id: string,
  extra: Record<string, unknown> = {},
) {
  // Policy URLs and Script source are configuration, never audit payloads.
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    action,
    targetType: 'navigation_policy',
    targetId: id,
    result: 'SUCCEEDED',
    changes: extra,
    metadata: { profileId },
  })
}

export class NavigationPolicyService {
  constructor(private readonly connection: DatabaseConnection) {}
  async getState(profileId: string) {
    return this.connection.db.transaction(async (tx) => {
      const target = await profile(tx, profileId, 'share')
      const [publication] = await tx
        .select()
        .from(profilePublications)
        .where(eq(profilePublications.profileId, profileId))
      const [draft] = await tx
        .select()
        .from(navigationPolicyVersions)
        .where(
          and(
            eq(navigationPolicyVersions.profileId, profileId),
            eq(navigationPolicyVersions.state, 'DRAFT'),
          ),
        )
        .orderBy(desc(navigationPolicyVersions.version))
        .limit(1)
      return {
        profile: target,
        publishedVersionId: publication?.navigationPolicyVersionId ?? null,
        draft: draft ? version(draft) : null,
      }
    })
  }
  async getVersion(profileId: string, id: string) {
    await profile(this.connection.db, profileId)
    return version(await readVersion(this.connection.db, profileId, id))
  }
  async listVersions(profileId: string, query: PageQuery) {
    await profile(this.connection.db, profileId)
    const cursor = query.cursor ? decodePageCursor(query.cursor) : undefined,
      limit = normalizePageLimit(query.limit)
    const rows = await this.connection.db
      .select({
        id: navigationPolicyVersions.id,
        profileId: navigationPolicyVersions.profileId,
        version: navigationPolicyVersions.version,
        state: navigationPolicyVersions.state,
        ruleCount: sql<number>`jsonb_array_length(${navigationPolicyVersions.rules})`,
        hasScript: sql<boolean>`${navigationPolicyVersions.policyScript} is not null`,
        changeSummary: navigationPolicyVersions.changeSummary,
        createdAt: navigationPolicyVersions.createdAt,
        publishedAt: navigationPolicyVersions.publishedAt,
        disabledAt: navigationPolicyVersions.disabledAt,
      })
      .from(navigationPolicyVersions)
      .where(
        and(
          eq(navigationPolicyVersions.profileId, profileId),
          ...(cursor
            ? [
                or(
                  lt(navigationPolicyVersions.createdAt, cursor.createdAt),
                  and(
                    eq(navigationPolicyVersions.createdAt, cursor.createdAt),
                    lt(navigationPolicyVersions.id, cursor.id),
                  ),
                )!,
              ]
            : []),
        ),
      )
      .orderBy(desc(navigationPolicyVersions.createdAt), desc(navigationPolicyVersions.id))
      .limit(limit + 1)
    const items = rows.slice(0, limit),
      last = items.at(-1),
      hasMore = rows.length > limit
    return {
      items: items.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
        disabledAt: row.disabledAt ? new Date(row.disabledAt).toISOString() : null,
      })),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodePageCursor({ id: last.id, createdAt: last.createdAt }) : null,
      },
    }
  }
  async saveDraft(profileId: string, input: SaveNavigationPolicyDraft, context: AuditContext) {
    compile(input.content)
    await validateScript(input.content)
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const [draft] = await tx
        .select()
        .from(navigationPolicyVersions)
        .where(
          and(
            eq(navigationPolicyVersions.profileId, profileId),
            eq(navigationPolicyVersions.state, 'DRAFT'),
          ),
        )
        .orderBy(desc(navigationPolicyVersions.version))
        .limit(1)
      const values = {
        rules: input.content.rules,
        defaultAction: input.content.defaultAction,
        policyScript: input.content.policyScript,
        changeSummary: input.changeSummary?.trim() || null,
      }
      let row: VersionRow
      if (draft) {
        ;[row] = (await tx
          .update(navigationPolicyVersions)
          .set(values)
          .where(eq(navigationPolicyVersions.id, draft.id))
          .returning()) as [VersionRow]
      } else {
        const [latest] = await tx
          .select({ version: navigationPolicyVersions.version })
          .from(navigationPolicyVersions)
          .where(eq(navigationPolicyVersions.profileId, profileId))
          .orderBy(desc(navigationPolicyVersions.version))
          .limit(1)
        ;[row] = (await tx
          .insert(navigationPolicyVersions)
          .values({
            ...values,
            id: createPublicId(),
            profileId,
            version: (latest?.version ?? 0) + 1,
            createdByUserId: context.actorUserId,
          })
          .returning()) as [VersionRow]
      }
      await audit(tx, context, profileId, 'navigation_policy.draft.save', row.id, {
        version: row.version,
        ruleCount: row.rules.length,
        hasScript: row.policyScript !== null,
      })
      return version(row)
    })
  }
  async preview(profileId: string, input: NavigationPolicyPreviewRequest) {
    await profile(this.connection.db, profileId)
    return compile(input.content)(input.url, input.context)
  }
  async publish(profileId: string, id: string, context: AuditContext) {
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const row = await readVersion(tx, profileId, id),
        content = version(row).content
      compile(content)
      await validateScript(content)
      const [published] = await tx
        .update(navigationPolicyVersions)
        .set({
          state: 'PUBLISHED',
          publishedAt: sql`coalesce(${navigationPolicyVersions.publishedAt}, now())`,
          disabledAt: null,
        })
        .where(eq(navigationPolicyVersions.id, id))
        .returning()
      await tx
        .insert(profilePublications)
        .values({ profileId, navigationPolicyVersionId: id, updatedByUserId: context.actorUserId })
        .onConflictDoUpdate({
          target: profilePublications.profileId,
          set: {
            navigationPolicyVersionId: id,
            updatedByUserId: context.actorUserId,
            updatedAt: sql`now()`,
          },
        })
      await audit(tx, context, profileId, 'navigation_policy.publish', id, { version: row.version })
      return version(published!)
    })
  }
  async disable(profileId: string, id: string, context: AuditContext) {
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const row = await readVersion(tx, profileId, id)
      if (row.state === 'DRAFT') fail('CONFLICT', 'A draft has not been published.')
      const [disabled] = await tx
        .update(navigationPolicyVersions)
        .set({
          state: 'DISABLED',
          disabledAt: sql`coalesce(${navigationPolicyVersions.disabledAt}, now())`,
        })
        .where(eq(navigationPolicyVersions.id, id))
        .returning()
      await tx
        .update(profilePublications)
        .set({
          navigationPolicyVersionId: null,
          updatedByUserId: context.actorUserId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(profilePublications.profileId, profileId),
            eq(profilePublications.navigationPolicyVersionId, id),
          ),
        )
      await audit(tx, context, profileId, 'navigation_policy.disable', id, { version: row.version })
      return version(disabled!)
    })
  }
}

async function validateScript(content: SaveNavigationPolicyDraft['content']) {
  try {
    await validateNavigationPolicyScript(content)
  } catch (cause) {
    if (cause instanceof NavigationPolicyError)
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: cause.message,
        details: { field: 'policyScript' },
      })
    throw cause
  }
}
