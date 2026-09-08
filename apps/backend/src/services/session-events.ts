import { createPublicId } from '@browshare/common'
import type { DatabaseConnection } from '@browshare/database'
import { sessionEvents } from '@browshare/database/schema'
import { sql } from 'drizzle-orm'
type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

export async function appendSessionEvent(
  tx: Transaction,
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(sessionEvents).values({
    id: createPublicId(),
    sessionId,
    eventType,
    payload,
    sequence: sql`(select coalesce(max(sequence), -1) + 1 from session_events where session_id=${sessionId})`,
  })
}
