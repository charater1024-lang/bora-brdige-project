/** Request limits apply while streaming, before decoding or JSON allocation. */
export class RequestBodyError extends Error {
  constructor(
    readonly code: "request_too_large" | "invalid_request" | "invalid_json",
    readonly status: 400 | 413,
  ) {
    super(code);
    this.name = "RequestBodyError";
  }
}

export type RequestBodyLimits = {
  maxBytes: number;
  /** Preserve existing UTF-16 string limits as well as the UTF-8 byte ceiling. */
  maxChars?: number;
};

export function characterBodyLimits(maxChars: number): RequestBodyLimits {
  return { maxChars, maxBytes: maxChars * 4 };
}

export async function readBoundedRequestText(
  request: Request,
  limits: RequestBodyLimits,
): Promise<string> {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1
    || (limits.maxChars !== undefined
      && (!Number.isSafeInteger(limits.maxChars) || limits.maxChars < 1))) {
    throw new Error("invalid_request_body_limits");
  }
  const declared = request.headers.get("content-length")?.trim();
  // This is an early rejection only. Missing, forged-small, or malformed
  // lengths never replace counting the bytes actually received.
  if (declared && /^\d+$/u.test(declared) && Number(declared) > limits.maxBytes) {
    void request.body?.cancel().catch(() => undefined);
    throw new RequestBodyError("request_too_large", 413);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limits.maxBytes) {
        throw new RequestBodyError("request_too_large", 413);
      }
      text += decoder.decode(value, { stream: true });
      if (limits.maxChars !== undefined && text.length > limits.maxChars) {
        throw new RequestBodyError("request_too_large", 413);
      }
    }
    text += decoder.decode();
    if (limits.maxChars !== undefined && text.length > limits.maxChars) {
      throw new RequestBodyError("request_too_large", 413);
    }
    return text;
  } catch (error) {
    // Cancellation is best effort: a hostile/stalled source's cancel promise
    // must not delay the error response or allow further buffering.
    void reader.cancel().catch(() => undefined);
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedRequestJson(
  request: Request,
  limits: RequestBodyLimits,
): Promise<unknown> {
  const text = await readBoundedRequestText(request, limits);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError("invalid_json", 400);
  }
}

export function requestBodyErrorResponse(error: unknown): Response | null {
  return error instanceof RequestBodyError
    ? Response.json({ error: error.code }, {
      status: error.status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    })
    : null;
}
