/** Escape PostgreSQL LIKE metacharacters so user search text remains literal. */
export function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
