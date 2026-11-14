import { discard } from '../sources/http'
import { PhotoProviderError } from './types'

/**
 * The body of a response, stopping as soon as it passes the limit. `who` is how
 * the message names the service ("Immich", "Unsplash"); it is written by the
 * provider, never taken from the response.
 */
export async function readBytes(response: Response, maxBytes: number, feedId: string, who: string): Promise<Buffer> {
  const tooLarge = () => new PhotoProviderError(feedId, `${who} sent more than ${Math.round(maxBytes / (1024 * 1024))} MB in one answer`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw tooLarge()
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
