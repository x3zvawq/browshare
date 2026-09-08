import { BrowShareError, createPublicId } from '@browshare/common'
import {
  SessionMediaSettingsSchema,
  type SessionMediaSettings,
  ViewerFocusPolicySchema,
  type ViewerFocusPolicy,
  SessionTransferSettingsSchema,
  type SessionTransferSettings,
  type RegistrationSettings,
} from '@browshare/contracts'
import { Value } from 'typebox/value'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, systemSettings } from '@browshare/database/schema'
import { eq, inArray, sql } from 'drizzle-orm'

type SettingsReader = Pick<DatabaseConnection['db'], 'select'>
const keys = ['registration.open', 'auth.require_email_verification', 'session.default_max_active']

export async function readRegistrationSettings(
  db: SettingsReader,
  lock?: 'share' | 'update',
): Promise<RegistrationSettings> {
  const query = db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, keys))
    .orderBy(systemSettings.key)
  const rows = await (lock ? query.for(lock) : query)
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const registrationOpen = values.get(keys[0]!)
  const emailVerificationRequired = values.get(keys[1]!)
  const defaultMaxActiveSessions = values.get(keys[2]!)
  if (
    typeof registrationOpen !== 'boolean' ||
    typeof emailVerificationRequired !== 'boolean' ||
    (defaultMaxActiveSessions !== null &&
      (typeof defaultMaxActiveSessions !== 'number' ||
        !Number.isSafeInteger(defaultMaxActiveSessions) ||
        defaultMaxActiveSessions < 0 ||
        defaultMaxActiveSessions > 1_000_000))
  ) {
    throw new Error('Registration settings are missing or invalid.')
  }
  return { registrationOpen, emailVerificationRequired, defaultMaxActiveSessions }
}

export async function readSessionTransferSettings(
  db: SettingsReader,
  lock?: 'share' | 'update',
): Promise<SessionTransferSettings> {
  const query = db.select().from(systemSettings).where(eq(systemSettings.key, 'session.transfers'))
  const [row] = await (lock ? query.for(lock) : query)
  if (
    !Value.Check(SessionTransferSettingsSchema, row?.value) ||
    row.value.maxFileBytes > row.value.maxTemporaryBytes
  )
    throw new Error('Session transfer settings are missing or invalid.')
  return row.value
}

export async function readViewerFocusPolicy(db: SettingsReader): Promise<ViewerFocusPolicy> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'viewer.focus'))
  if (!Value.Check(ViewerFocusPolicySchema, row?.value))
    throw new Error('Viewer focus settings are missing or invalid.')
  return row.value
}

export async function readSessionMediaSettings(
  db: SettingsReader,
  lock?: 'share' | 'update',
): Promise<SessionMediaSettings> {
  const query = db.select().from(systemSettings).where(eq(systemSettings.key, 'session.media'))
  const [row] = await (lock ? query.for(lock) : query)
  if (!Value.Check(SessionMediaSettingsSchema, row?.value))
    throw new Error('Session media settings are missing or invalid.')
  return row.value
}

export class SystemSettingsService {
  constructor(private readonly connection: DatabaseConnection) {}

  getMedia(): Promise<SessionMediaSettings> {
    return readSessionMediaSettings(this.connection.db)
  }

  async saveMedia(
    input: SessionMediaSettings,
    context: { actorUserId: string; requestId: string },
  ): Promise<SessionMediaSettings> {
    return this.connection.db.transaction(async (tx) => {
      const previous = await readSessionMediaSettings(tx, 'update')
      await tx
        .update(systemSettings)
        .set({
          value: sql`${JSON.stringify(input)}::jsonb`,
          revision: sql`${systemSettings.revision} + 1`,
          updatedByUserId: context.actorUserId,
          updatedAt: sql`now()`,
        })
        .where(eq(systemSettings.key, 'session.media'))
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        action: 'system.media.update',
        targetType: 'system_setting',
        targetId: 'session.media',
        result: 'SUCCEEDED',
        changes: { before: previous, after: input },
        metadata: {},
      })
      return input
    })
  }

  getViewerFocus(): Promise<ViewerFocusPolicy> {
    return readViewerFocusPolicy(this.connection.db)
  }

  async saveViewerFocus(
    input: ViewerFocusPolicy,
    context: { actorUserId: string; requestId: string },
  ): Promise<ViewerFocusPolicy> {
    return this.connection.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'viewer.focus'))
        .for('update')
      if (!Value.Check(ViewerFocusPolicySchema, previous?.value))
        throw new Error('Viewer focus settings are missing or invalid.')
      await tx
        .update(systemSettings)
        .set({
          value: sql`${JSON.stringify(input)}::jsonb`,
          revision: sql`${systemSettings.revision} + 1`,
          updatedByUserId: context.actorUserId,
          updatedAt: sql`now()`,
        })
        .where(eq(systemSettings.key, 'viewer.focus'))
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        action: 'system.viewer_focus.update',
        targetType: 'system_setting',
        targetId: 'viewer.focus',
        result: 'SUCCEEDED',
        changes: { before: previous.value, after: input },
        metadata: {},
      })
      return input
    })
  }

  getTransfers(): Promise<SessionTransferSettings> {
    return readSessionTransferSettings(this.connection.db)
  }

  async saveTransfers(
    input: SessionTransferSettings,
    context: { actorUserId: string; requestId: string },
  ): Promise<SessionTransferSettings> {
    if (input.maxFileBytes > input.maxTemporaryBytes)
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'The file limit must not exceed the Session temporary quota.',
      })
    return this.connection.db.transaction(async (tx) => {
      const previous = await readSessionTransferSettings(tx, 'update')
      await tx
        .update(systemSettings)
        .set({
          value: sql`${JSON.stringify(input)}::jsonb`,
          revision: sql`${systemSettings.revision} + 1`,
          updatedByUserId: context.actorUserId,
          updatedAt: sql`now()`,
        })
        .where(eq(systemSettings.key, 'session.transfers'))
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        action: 'system.transfers.update',
        targetType: 'system_setting',
        targetId: 'session.transfers',
        result: 'SUCCEEDED',
        changes: { before: previous, after: input },
        metadata: {},
      })
      return input
    })
  }

  getRegistration(): Promise<RegistrationSettings> {
    return readRegistrationSettings(this.connection.db)
  }

  async saveRegistration(
    input: RegistrationSettings,
    context: { actorUserId: string; requestId: string },
  ): Promise<RegistrationSettings> {
    if (input.emailVerificationRequired)
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'Email verification cannot be enabled until a mail provider is available.',
      })
    return this.connection.db.transaction(async (tx) => {
      const previous = await readRegistrationSettings(tx, 'update')
      const entries = [
        ['registration.open', input.registrationOpen],
        ['auth.require_email_verification', input.emailVerificationRequired],
        ['session.default_max_active', input.defaultMaxActiveSessions],
      ] as const
      for (const [key, value] of entries)
        await tx
          .update(systemSettings)
          .set({
            value: sql`${JSON.stringify(value)}::jsonb`,
            revision: sql`${systemSettings.revision} + 1`,
            updatedByUserId: context.actorUserId,
            updatedAt: sql`now()`,
          })
          .where(eq(systemSettings.key, key))
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        action: 'system.registration.update',
        targetType: 'system_setting',
        targetId: 'registration',
        result: 'SUCCEEDED',
        changes: { before: previous, after: input },
        metadata: {},
      })
      return input
    })
  }
}
