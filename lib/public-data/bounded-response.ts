export class PublicResponseBodyError extends Error {
  constructor(readonly code: "invalid-limit" | "too-large") {
    super(`public_response_body_${code}`);
  }
}

/**
 * Reads an upstream body without ever buffering more than the declared byte
 * ceiling. Content-Length is only an early rejection; streamed bytes remain
 * the source of truth when the header is absent or incorrect.
 */
export async function readBoundedResponseText(response: Response, maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new PublicResponseBodyError("invalid-limit");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new PublicResponseBodyError("too-large");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new PublicResponseBodyError("too-large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PublicResponseBodyError("too-large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
