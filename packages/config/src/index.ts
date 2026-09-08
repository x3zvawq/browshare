import { readFileSync } from 'node:fs'

export type Environment = Readonly<Record<string, string | undefined>>

export function requiredText(
  environment: Environment,
  name: string,
  options: { minLength?: number; maxLength?: number } = {},
): string {
  const value = environment[name]
  if (value === undefined || value.length === 0) {
    throw new TypeError(`Missing required environment variable ${name}`)
  }
  assertLength(name, value, options)
  return value
}

export function optionalText(
  environment: Environment,
  name: string,
  options: { defaultValue?: string; minLength?: number; maxLength?: number } = {},
): string | undefined {
  const value = environment[name] ?? options.defaultValue
  if (value === undefined) return undefined
  if (value.length === 0) throw new TypeError(`Environment variable ${name} must not be empty`)
  assertLength(name, value, options)
  return value
}

export function integer(
  environment: Environment,
  name: string,
  options: { defaultValue?: number; minimum?: number; maximum?: number } = {},
): number {
  const source = environment[name]
  if (source === undefined) {
    if (options.defaultValue === undefined) {
      throw new TypeError(`Missing required environment variable ${name}`)
    }
    return options.defaultValue
  }
  if (!/^-?\d+$/u.test(source)) {
    throw new TypeError(`Environment variable ${name} must be an integer`)
  }
  const value = Number(source)
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Environment variable ${name} must be a safe integer`)
  }
  if (options.minimum !== undefined && value < options.minimum) {
    throw new RangeError(`Environment variable ${name} must be at least ${options.minimum}`)
  }
  if (options.maximum !== undefined && value > options.maximum) {
    throw new RangeError(`Environment variable ${name} must be at most ${options.maximum}`)
  }
  return value
}

export function boolean(environment: Environment, name: string, defaultValue: boolean): boolean {
  const source = environment[name]
  if (source === undefined) return defaultValue
  if (source === 'true' || source === '1') return true
  if (source === 'false' || source === '0') return false
  throw new TypeError(`Environment variable ${name} must be true, false, 1 or 0`)
}

export function stringList(
  environment: Environment,
  name: string,
  defaultValue: readonly string[] = [],
): readonly string[] {
  const source = environment[name]
  if (source === undefined) return [...defaultValue]
  const values = source
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (values.length === 0) throw new TypeError(`Environment variable ${name} has no values`)
  return [...new Set(values)]
}

export function enumeration<const Value extends string>(
  environment: Environment,
  name: string,
  values: readonly Value[],
  defaultValue?: Value,
): Value {
  const source = environment[name] ?? defaultValue
  if (source === undefined) throw new TypeError(`Missing required environment variable ${name}`)
  if (!values.includes(source as Value)) {
    throw new TypeError(`Environment variable ${name} must be one of ${values.join(', ')}`)
  }
  return source as Value
}

export function secret(
  environment: Environment,
  name: string,
  options: { minLength?: number; maxLength?: number } = {},
): string {
  const value = optionalSecret(environment, name, options)
  if (value === undefined) {
    throw new TypeError(`Missing required secret ${name} or ${name}_FILE`)
  }
  return value
}

export function optionalSecret(
  environment: Environment,
  name: string,
  options: { minLength?: number; maxLength?: number } = {},
): string | undefined {
  const direct = environment[name]
  const fileName = environment[`${name}_FILE`]
  if (direct !== undefined && fileName !== undefined) {
    throw new TypeError(`Set only one of ${name} or ${name}_FILE`)
  }
  let value: string
  if (fileName !== undefined) {
    if (fileName.length === 0) throw new TypeError(`${name}_FILE must not be empty`)
    try {
      value = readFileSync(fileName, 'utf8').replace(/[\r\n]+$/u, '')
    } catch (cause) {
      throw new TypeError(`Unable to read ${name}_FILE`, { cause })
    }
  } else if (direct !== undefined) {
    value = direct
  } else {
    return undefined
  }
  if (value.length === 0) throw new TypeError(`Secret ${name} must not be empty`)
  assertLength(name, value, options)
  return value
}

function assertLength(
  name: string,
  value: string,
  options: { minLength?: number; maxLength?: number },
): void {
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new RangeError(`${name} must contain at least ${options.minLength} characters`)
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new RangeError(`${name} must contain at most ${options.maxLength} characters`)
  }
}
