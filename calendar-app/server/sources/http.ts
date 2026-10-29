import type { SourceError } from './errors'

// The parts of fetching over HTTP that no source cares about the details of:
// reading a body up to a limit, and saying what went wrong without the URL.

/** Reads the body as UTF-8, stopping as soon as it passes the limit. `tooLarge` makes the error to throw then. */
export async function readBody(response: Response, maxBytes: number, tooLarge: () => SourceError): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > maxBytes) throw tooLarge()
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw tooLarge()
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export function tooLargeMessage(maxBytes: number): string {
  return `the calendar is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`
}

// Whatever went wrong, say it without the original message: undici's messages
// can name the host, and Node's can carry the whole URL.
export function networkErrorMessage(error: unknown, timeoutMs: number): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `timed out after ${+(timeoutMs / 1000).toFixed(2)} s`
  }
  const code = errorCode(error)
  return code ? `could not connect (${code})` : 'could not connect'
}

export function errorCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}
