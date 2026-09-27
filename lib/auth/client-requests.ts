/** Same-origin auth UI requests: one deadline covers headers and JSON body. */
export async function fetchAuthJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const upstream = init.signal;
  let rejectCancelled: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const cancel = () => rejectCancelled(controller.signal.reason ?? new DOMException("Request cancelled", "AbortError"));
  controller.signal.addEventListener("abort", cancel, { once: true });
  const abortFromUpstream = () => controller.abort(upstream?.reason);
  if (upstream?.aborted) abortFromUpstream();
  else upstream?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await Promise.race([cancelled, (async () => {
      controller.signal.throwIfAborted();
      const response = await fetch(input, { ...init, signal: controller.signal });
      controller.signal.throwIfAborted();
      const data = await response.json() as T;
      controller.signal.throwIfAborted();
      return { response, data };
    })()]);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", cancel);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}

export function localLogoutCompleted(response: Pick<Response, "ok" | "status">, data: unknown): boolean {
  if (response.ok) return true;
  // This exact server contract means the browser cookie was cleared even
  // though server-side revocation could not be confirmed. Never infer success
  // from a generic 503, an opaque network failure, or a merely truthy value.
  return response.status === 503 && !!data && typeof data === "object"
    && (data as Record<string, unknown>).loggedOut === true
    && (data as Record<string, unknown>).storageAvailable === false;
}
