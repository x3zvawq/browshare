import { Script } from 'node:vm'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  normalizePageLimit,
} from '@browshare/common'
import type { PageScriptVersion, PageQuery, SavePageScriptDraft } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  pageScriptVersions,
  profilePublications,
  profiles,
} from '@browshare/database/schema'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { PolicyTransaction } from './session-policy-rules.js'

type Reader = DatabaseConnection['db'] | PolicyTransaction
type VersionRow = typeof pageScriptVersions.$inferSelect
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
function version(row: VersionRow): PageScriptVersion {
  return {
    id: row.id,
    profileId: row.profileId,
    version: row.version,
    state: row.state,
    appliesTo: row.appliesTo,
    changeSummary: row.changeSummary,
    createdAt: new Date(row.createdAt).toISOString(),
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    disabledAt: row.disabledAt ? new Date(row.disabledAt).toISOString() : null,
    content: {
      source: row.sourceCode,
      appliesTo: row.appliesTo,
    },
  }
}
async function readVersion(db: Reader, profileId: string, id: string) {
  const [row] = await db
    .select()
    .from(pageScriptVersions)
    .where(and(eq(pageScriptVersions.profileId, profileId), eq(pageScriptVersions.id, id)))
  if (!row) fail('NOT_FOUND', 'Page Script version not found.')
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
  // Script source and change summaries never enter audit payloads.
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    action,
    targetType: 'page_script',
    targetId: id,
    result: 'SUCCEEDED',
    changes: extra,
    metadata: { profileId },
  })
}

export class PageScriptService {
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
        .from(pageScriptVersions)
        .where(
          and(eq(pageScriptVersions.profileId, profileId), eq(pageScriptVersions.state, 'DRAFT')),
        )
        .orderBy(desc(pageScriptVersions.version))
        .limit(1)
      return {
        profile: target,
        publishedVersionId: publication?.pageScriptVersionId ?? null,
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
        id: pageScriptVersions.id,
        profileId: pageScriptVersions.profileId,
        version: pageScriptVersions.version,
        state: pageScriptVersions.state,
        appliesTo: pageScriptVersions.appliesTo,
        changeSummary: pageScriptVersions.changeSummary,
        createdAt: pageScriptVersions.createdAt,
        publishedAt: pageScriptVersions.publishedAt,
        disabledAt: pageScriptVersions.disabledAt,
      })
      .from(pageScriptVersions)
      .where(
        and(
          eq(pageScriptVersions.profileId, profileId),
          ...(cursor
            ? [
                or(
                  lt(pageScriptVersions.createdAt, cursor.createdAt),
                  and(
                    eq(pageScriptVersions.createdAt, cursor.createdAt),
                    lt(pageScriptVersions.id, cursor.id),
                  ),
                )!,
              ]
            : []),
        ),
      )
      .orderBy(desc(pageScriptVersions.createdAt), desc(pageScriptVersions.id))
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
  async saveDraft(profileId: string, input: SavePageScriptDraft, context: AuditContext) {
    await validateScript(input.content)
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const [draft] = await tx
        .select()
        .from(pageScriptVersions)
        .where(
          and(eq(pageScriptVersions.profileId, profileId), eq(pageScriptVersions.state, 'DRAFT')),
        )
        .orderBy(desc(pageScriptVersions.version))
        .limit(1)
      const values = {
        sourceCode: input.content.source,
        appliesTo: input.content.appliesTo,
        changeSummary: input.changeSummary?.trim() || null,
      }
      let row: VersionRow
      if (draft) {
        ;[row] = (await tx
          .update(pageScriptVersions)
          .set(values)
          .where(eq(pageScriptVersions.id, draft.id))
          .returning()) as [VersionRow]
      } else {
        const [latest] = await tx
          .select({ version: pageScriptVersions.version })
          .from(pageScriptVersions)
          .where(eq(pageScriptVersions.profileId, profileId))
          .orderBy(desc(pageScriptVersions.version))
          .limit(1)
        ;[row] = (await tx
          .insert(pageScriptVersions)
          .values({
            ...values,
            id: createPublicId(),
            profileId,
            version: (latest?.version ?? 0) + 1,
            createdByUserId: context.actorUserId,
          })
          .returning()) as [VersionRow]
      }
      await audit(tx, context, profileId, 'page_script.draft.save', row.id, {
        version: row.version,
        appliesTo: row.appliesTo,
      })
      return version(row)
    })
  }
  async publish(profileId: string, id: string, context: AuditContext) {
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const row = await readVersion(tx, profileId, id),
        content = version(row).content
      await validateScript(content)
      const [published] = await tx
        .update(pageScriptVersions)
        .set({
          state: 'PUBLISHED',
          publishedAt: sql`coalesce(${pageScriptVersions.publishedAt}, now())`,
          disabledAt: null,
        })
        .where(eq(pageScriptVersions.id, id))
        .returning()
      await tx
        .insert(profilePublications)
        .values({ profileId, pageScriptVersionId: id, updatedByUserId: context.actorUserId })
        .onConflictDoUpdate({
          target: profilePublications.profileId,
          set: {
            pageScriptVersionId: id,
            updatedByUserId: context.actorUserId,
            updatedAt: sql`now()`,
          },
        })
      await audit(tx, context, profileId, 'page_script.publish', id, { version: row.version })
      return version(published!)
    })
  }
  async disable(profileId: string, id: string, context: AuditContext) {
    return this.connection.db.transaction(async (tx) => {
      await profile(tx, profileId, 'update')
      const row = await readVersion(tx, profileId, id)
      if (row.state === 'DRAFT') fail('CONFLICT', 'A draft has not been published.')
      const [disabled] = await tx
        .update(pageScriptVersions)
        .set({
          state: 'DISABLED',
          disabledAt: sql`coalesce(${pageScriptVersions.disabledAt}, now())`,
        })
        .where(eq(pageScriptVersions.id, id))
        .returning()
      await tx
        .update(profilePublications)
        .set({
          pageScriptVersionId: null,
          updatedByUserId: context.actorUserId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(profilePublications.profileId, profileId),
            eq(profilePublications.pageScriptVersionId, id),
          ),
        )
      await audit(tx, context, profileId, 'page_script.disable', id, { version: row.version })
      return version(disabled!)
    })
  }
}

function validateScript(content: SavePageScriptDraft['content']) {
  try {
    // Parse the same function-body grammar used by Core; never execute administrator source here.
    new Script(`(() => {\n${content.source}\n}).call(globalThis)`)
  } catch {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'Page Script syntax is invalid.',
      details: { field: 'source' },
    })
  }
}
