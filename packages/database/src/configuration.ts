import { secret, type Environment } from '@browshare/config'

export interface DatabaseConfiguration {
  readonly url: string
}

export function loadDatabaseConfiguration(
  environment: Environment = process.env,
): DatabaseConfiguration {
  const url = secret(environment, 'DATABASE_URL', { maxLength: 16_384 })
  assertPostgresUrl(url)
  return { url }
}

function assertPostgresUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL', { cause })
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new TypeError('DATABASE_URL must use the postgres or postgresql scheme')
  }
}
