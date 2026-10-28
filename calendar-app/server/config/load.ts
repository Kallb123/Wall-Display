import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import type { ScalarTag } from 'yaml'
import type { $ZodIssue } from 'zod/v4/core'
import { createConfigSchema } from './schema'
import type { AppConfig } from './schema'
import type { Env } from './paths'

export interface LoadConfigOptions {
  /** The config file to read. */
  configFile: string
  /** Defaults to `secrets.yaml` next to the config file. */
  secretsFile?: string
  /** Defaults to `process.env`. Pass an object in tests. */
  env?: Env
}

/** Thrown for any problem with the config. `problems` has one entry per line of the message. */
export class ConfigError extends Error {
  declare readonly problems: string[]

  constructor(header: string, problems: string[]) {
    super([header, ...problems.map(problem => `  ${problem}`)].join('\n'))
    this.name = 'ConfigError'
    // Not enumerable, so a crash prints the message once instead of dumping the array too.
    Object.defineProperty(this, 'problems', { value: problems })
    // The stack frames point into the bundle and tell the reader nothing.
    this.stack = `${this.name}: ${this.message}`
  }
}

/** What `!secret name` becomes while the YAML is parsed, until the second pass swaps in the value. */
class SecretRef {
  constructor(readonly name: string) {}
}

const secretTag: ScalarTag = {
  tag: '!secret',
  resolve(name, onError) {
    if (name.trim() === '') onError('!secret needs a secret name, for example: !secret family_ics_url')
    return new SecretRef(name.trim())
  },
}

export function secretEnvName(name: string): string {
  return `WALLCAL_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** Loads, validates and freezes the config. Throws `ConfigError` if anything is wrong. */
export function loadConfig(options: LoadConfigOptions): AppConfig {
  const configFile = resolve(options.configFile)
  const secretsFile = resolve(options.secretsFile ?? resolve(dirname(configFile), 'secrets.yaml'))
  const env = options.env ?? process.env
  const header = `Invalid config in ${configFile}`

  const problems: string[] = []
  // Where a value came from, by config path, so errors can name a secret instead of showing it.
  const origins = new Map<string, string>()
  const secretValues = new Set<string>()

  const text = readText(configFile)
  if (text.error) {
    throw new ConfigError('Cannot load config', [
      text.missing
        ? `config file not found: ${configFile} (set WALLCAL_CONFIG_FILE to the file, or WALLCAL_CONFIG_DIR to the folder holding config.yaml)`
        : `cannot read config file ${configFile}: ${text.error}`,
    ])
  }

  const document = parseDocument(text.content, { customTags: [secretTag] })
  const yamlProblems = [...document.errors, ...document.warnings]
  if (yamlProblems.length > 0) {
    throw new ConfigError(header, yamlProblems.map(problem => describeYamlProblem(configFile, problem)))
  }
  const raw: unknown = document.toJS()

  // Second pass: swap each !secret marker for its value.
  const lookup = new SecretLookup(secretsFile, env, problems)
  const unresolved = new Set<string>()
  walk(raw, [], (ref, path) => {
    const where = formatPath(path)
    const value = lookup.get(ref.name, where)
    if (value === undefined) {
      unresolved.add(where)
      return undefined
    }
    origins.set(where, `secret "${ref.name}"`)
    secretValues.add(value)
    return value
  })

  // WALLCAL_TIMEZONE overrides `timezone`.
  if (set(env.WALLCAL_TIMEZONE) && isRecord(raw)) {
    raw.timezone = env.WALLCAL_TIMEZONE
    origins.set('timezone', 'env WALLCAL_TIMEZONE')
  }

  const result = createConfigSchema(dirname(configFile)).safeParse(raw, { error: friendlyMessage })
  if (!result.success) {
    for (const issue of result.error.issues) {
      for (const problem of describeIssue(issue, origins, unresolved)) problems.push(problem)
    }
  }

  if (!result.success || problems.length > 0) {
    throw new ConfigError(header, problems.map(problem => scrub(problem, secretValues)))
  }
  return deepFreeze(result.data)
}

function set(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(file: string): { content: string, error?: undefined, missing?: undefined } | { content: string, error: string, missing: boolean } {
  try {
    return { content: readFileSync(file, 'utf8') }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    return { content: '', error: code, missing: code === 'ENOENT' }
  }
}

/** Only the first line of a YAML error: the rest is a snippet of the file, which could hold secrets. */
function describeYamlProblem(file: string, problem: { message: string, linePos?: [{ line: number, col: number }, ...unknown[]] }): string {
  const position = problem.linePos?.[0]
  const summary = problem.message.split('\n')[0]!.replace(/ at line \d+, column \d+:?$/, '')
  return `${file}${position ? `:${position.line}:${position.col}` : ''}: ${summary}`
}

class SecretLookup {
  private file: Record<string, string> | undefined
  private fileState: 'unread' | 'missing' | 'broken' | 'ok' = 'unread'

  constructor(private readonly path: string, private readonly env: Env, private readonly problems: string[]) {}

  get(name: string, configPath: string): string | undefined {
    const envName = secretEnvName(name)
    const fromEnv = this.env[envName]
    if (set(fromEnv)) return fromEnv

    this.read()
    const value = this.file?.[name]
    if (value !== undefined && value !== '') return value

    const reason = this.fileState === 'missing' ? 'file not found' : value === '' ? 'key is empty' : 'no such key'
    this.problems.push(`${configPath}: secret "${name}" is not set. Looked for env var ${envName}, then key "${name}" in ${this.path} (${reason})`)
    return undefined
  }

  private read() {
    if (this.fileState !== 'unread') return
    const text = readText(this.path)
    if (text.error) {
      this.fileState = text.missing ? 'missing' : 'broken'
      if (!text.missing) this.problems.push(`${this.path}: cannot read secrets file (${text.error})`)
      return
    }
    // "failsafe" keeps every value as text, so a PIN like 0123 stays 0123.
    const document = parseDocument(text.content, { schema: 'failsafe' })
    const yamlProblems = [...document.errors, ...document.warnings]
    const data: unknown = document.toJS()
    if (yamlProblems.length > 0) {
      this.fileState = 'broken'
      for (const problem of yamlProblems) this.problems.push(describeYamlProblem(this.path, problem))
      return
    }
    if (data === null || data === undefined) {
      this.file = {}
    } else if (isRecord(data)) {
      const file: Record<string, string> = {}
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') file[key] = value
        else this.problems.push(`${this.path}: "${key}" must be a single text value`)
      }
      this.file = file
    } else {
      this.fileState = 'broken'
      this.problems.push(`${this.path}: must be a mapping of secret names to values`)
      return
    }
    this.fileState = 'ok'
  }
}

/** Replaces each SecretRef (in place) with whatever `resolve` returns. */
function walk(node: unknown, path: (string | number)[], resolve: (ref: SecretRef, path: (string | number)[]) => string | undefined) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      if (item instanceof SecretRef) node[index] = resolve(item, [...path, index])
      else walk(item, [...path, index], resolve)
    })
  } else if (isRecord(node)) {
    for (const [key, item] of Object.entries(node)) {
      if (item instanceof SecretRef) node[key] = resolve(item, [...path, key])
      else walk(item, [...path, key], resolve)
    }
  }
}

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return 'config'
  return path.map((part, index) => typeof part === 'number' ? `[${part}]` : index === 0 ? String(part) : `.${String(part)}`).join('')
}

function friendlyMessage(issue: { code?: string, input?: unknown }): string | undefined {
  if (issue.code === 'invalid_type' && issue.input === undefined) return 'is required'
  return undefined
}

function describeIssue(issue: $ZodIssue, origins: Map<string, string>, unresolved: Set<string>): string[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map(key => `${formatPath([...issue.path, key])}: unknown setting, check the spelling`)
  }
  const path = formatPath(issue.path)
  // The secret is already reported as missing; skip the follow-on errors.
  if ([...unresolved].some(item => isSameOrInside(path, item))) return []
  const origin = [...origins].find(([item]) => isSameOrInside(path, item))?.[1]
  return [`${path}: ${issue.message}${origin ? ` (value comes from ${origin})` : ''}`]
}

function isSameOrInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`)
}

/** Last line of defence: no secret value may appear in an error. */
function scrub(message: string, secretValues: Set<string>): string {
  let result = message
  for (const value of secretValues) {
    if (value.length >= 4) result = result.split(value).join('***')
  }
  return result
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}
