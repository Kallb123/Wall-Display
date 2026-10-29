import { describe, expect, it } from 'vitest'
import { checkHomeAssistant } from '../../../../server/sources/homeassistant/ping'

const TOKEN = 'ha-long-lived-token-0123456789abcdef'
const BASE = 'http://homeassistant.example.test:8123'

interface Call {
  url: string
  headers: Record<string, string>
  signal: AbortSignal | undefined
}

/** A stub `fetch` that answers (or fails) as told, and records what it was asked. */
function stub(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, signal: init?.signal ?? undefined })
    return respond()
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

/** The result of a check that failed, after making sure it says nothing about where it went or what it sent. */
async function failure(check: Promise<Awaited<ReturnType<typeof checkHomeAssistant>>>): Promise<string> {
  const result = await check
  if (result.ok) throw new Error('expected the check to fail')
  for (const secret of [TOKEN, 'homeassistant.example.test', '8123', '127.0.0.1']) expect(result.error).not.toContain(secret)
  return result.error
}

describe('checkHomeAssistant', () => {
  it('asks GET <url>/api/ with the token as a bearer, and is ok when Home Assistant answers', async () => {
    const { fetch, calls } = stub(() => Response.json({ message: 'API running.' }))

    expect(await checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch })).toEqual({ ok: true })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${BASE}/api/`)
    expect(calls[0]!.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
  })

  it('copes with a trailing slash and a path on the URL, and drops a query and a fragment', async () => {
    const { fetch, calls } = stub(() => Response.json({}))

    await checkHomeAssistant({ url: `${BASE}/`, token: TOKEN }, { fetch })
    await checkHomeAssistant({ url: `${BASE}/ha/?a=1#top`, token: TOKEN }, { fetch })

    expect(calls.map(call => call.url)).toEqual([`${BASE}/api/`, `${BASE}/ha/api/`])
  })

  it.each([401, 403])('says Home Assistant refused the token for a %i', async (status) => {
    const { fetch } = stub(() => new Response('{"message":"401: Unauthorized"}', { status }))

    expect(await failure(checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch }))).toBe(`Home Assistant refused the access token (HTTP ${status})`)
  })

  it('reports any other status as it is', async () => {
    const { fetch } = stub(() => new Response('', { status: 502, statusText: 'Bad Gateway' }))

    expect(await failure(checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch }))).toBe('HTTP 502 Bad Gateway')
  })

  it('says it could not connect, with the code and without the address, when the request fails', async () => {
    const { fetch } = stub(() => {
      throw Object.assign(new TypeError(`fetch failed: connect ECONNREFUSED ${BASE} with ${TOKEN}`), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8123'), { code: 'ECONNREFUSED' }) })
    })

    expect(await failure(checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch }))).toBe('could not connect (ECONNREFUSED)')
  })

  it('says it timed out, and gives the request a signal that aborts after the timeout', async () => {
    const { fetch, calls } = stub(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })

    expect(await failure(checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch, timeoutMs: 2500 }))).toBe('timed out after 2.5 s')
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('times out for real when nothing answers', async () => {
    const hang = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as typeof fetch

    expect(await failure(checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch: hang, timeoutMs: 20 }))).toBe('timed out after 0.02 s')
  })

  it('says the URL is not valid without quoting it', async () => {
    const { fetch, calls } = stub(() => Response.json({}))

    const result = await checkHomeAssistant({ url: 'not a url, with-a-secret-in-it', token: TOKEN }, { fetch })

    expect(result).toEqual({ ok: false, error: 'the Home Assistant URL is not valid' })
    expect(calls).toEqual([])
  })

  it('gives up on a body it does not need to read', async () => {
    let cancelled = false
    const body = new ReadableStream({ cancel: () => void (cancelled = true) })
    const { fetch } = stub(() => new Response(body, { status: 200 }))

    await checkHomeAssistant({ url: BASE, token: TOKEN }, { fetch })

    expect(cancelled).toBe(true)
  })
})
