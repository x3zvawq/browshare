import type { TabSession } from '@/api/types.js'
export function sessionName(session: TabSession): string {
  return session.displayName ?? session.remoteTitle ?? session.profileName
}
export function isSessionTerminal(session: TabSession): boolean {
  return session.status === 'CLOSED' || session.status === 'FAILED'
}
export function canOpenSession(session: TabSession): boolean {
  return !isSessionTerminal(session) && session.status !== 'CLOSING'
}
