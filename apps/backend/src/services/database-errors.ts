interface PostgresDiagnostic {
  readonly code?: string
  readonly constraint_name?: string
}

export function findPostgresDiagnostic(cause: unknown): PostgresDiagnostic | undefined {
  let current = cause
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const record = current as Readonly<Record<string, unknown>>
    if (typeof record.code === 'string') {
      return {
        code: record.code,
        ...(typeof record.constraint_name === 'string'
          ? { constraint_name: record.constraint_name }
          : {}),
      }
    }
    current = record.cause
  }
  return undefined
}

export function isPostgresUniqueViolation(cause: unknown): boolean {
  return findPostgresDiagnostic(cause)?.code === '23505'
}

export function isLastSystemManagerViolation(cause: unknown): boolean {
  const diagnostic = findPostgresDiagnostic(cause)
  return diagnostic?.code === '23514' && diagnostic.constraint_name === 'system_manager_required'
}
