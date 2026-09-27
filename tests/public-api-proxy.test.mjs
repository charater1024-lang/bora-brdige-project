import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const proxyPath = fileURLToPath(new URL("../deploy/public-api-proxy.mjs", import.meta.url));
const token = "test-token-0123456789-abcdefghijklmnopqrstuvwxyz";

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.status === 200) return;
    } catch {
      // The child process may still be binding its loopback socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("proxy_start_timeout");
}

test("loopback public API proxy rejects unauthenticated and malformed requests", async (context) => {
  const port = 32_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, [proxyPath], {
    env: { ...process.env, PUBLIC_API_PROXY_TOKEN: token, PUBLIC_API_PROXY_PORT: String(port) },
    stdio: "ignore",
  });
  context.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  const unauthorized = await fetch(`${baseUrl}/v1/dart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: {} }),
  });
  assert.equal(unauthorized.status, 401);

  const invalidParameter = await fetch(`${baseUrl}/v1/dart`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ params: { url: "https://example.com" } }),
  });
  assert.equal(invalidParameter.status, 400);

  const malformed = await fetch(`${baseUrl}/v1/dart`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${baseUrl}/v1/dart`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "x".repeat(33_000),
  });
  assert.equal(oversized.status, 413);
});
