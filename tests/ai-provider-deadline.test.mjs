import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROVIDER_ADAPTERS, generateAICompletion } from "../lib/ai/providers.ts";

const request = { provider: "local", messages: [{ role: "user", content: "synthetic input" }] };
const env = { LOCAL_LLM_BASE_URL: "http://example.invalid/v1" };

test("provider deadline includes a stalled response body and cancels its reader", async () => {
  let cancelled = false;
  let signal;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(AI_PROVIDER_ADAPTERS.local.complete(request, env, async (_url, init) => {
    signal = init.signal;
    return response;
  }, 25), /provider_request_aborted/u);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("caller cancellation does not wait for the configured provider deadline", async () => {
  const controller = new AbortController();
  let signal;
  const running = AI_PROVIDER_ADAPTERS.local.complete({ ...request, signal: controller.signal }, env,
    async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, 10000);
  controller.abort();
  await assert.rejects(running, /provider_request_aborted/u);
  assert.equal(signal.aborted, true);
});

test("already cancelled requests never call the provider", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(AI_PROVIDER_ADAPTERS.local.complete({ ...request, signal: controller.signal }, env,
    async () => { assert.fail("network must not start"); }, 50), /provider_request_aborted/u);
});

test("oversized provider JSON is cancelled without allocating an unlimited body", async () => {
  let cancelled = false;
  await assert.rejects(AI_PROVIDER_ADAPTERS.local.complete(request, env, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })), 100), /provider_response_too_large/u);
  assert.equal(cancelled, true);
});

test("safe availability codes survive the existing fallback result contract", async () => {
  for (const code of ["model_warming", "local_inference_busy", "local_inference_timeout"]) {
    const result = await generateAICompletion(request, { env,
      fetcher: async () => Response.json({ detail: code }, { status: 503 }) });
    assert.equal(result.demo, true);
    assert.equal(result.demoReason, "provider_error");
    assert.equal(result.providerError, code);
  }
});

test("a normal JSON completion preserves the response and does not serialize the AbortSignal", async () => {
  const result = await AI_PROVIDER_ADAPTERS.local.complete({ ...request, signal: new AbortController().signal }, env,
    async (_url, init) => {
      assert.equal("signal" in JSON.parse(init.body), false);
      return Response.json({ choices: [{ message: { content: "synthetic answer" } }] });
    }, 100);
  assert.equal(result.demo, false);
  assert.equal(result.content, "synthetic answer");
});
