import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { createServer } from "vite";

const originalEnvironment = {
  APP_BASE_URL: process.env.APP_BASE_URL,
  KAKAO_REDIRECT_URI: process.env.KAKAO_REDIRECT_URI,
};
let modulePromise;
let viteServer;

async function securityModules() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const server = await createServer({
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        server: { middlewareMode: true },
      });
      viteServer = server;
      const [config, http, headers] = await Promise.all([
        server.ssrLoadModule("/lib/auth/config.ts"),
        server.ssrLoadModule("/lib/auth/http.ts"),
        server.ssrLoadModule("/lib/http/security-headers.ts"),
      ]);
      return { server, config, http, headers };
    })();
  }
  return modulePromise;
}

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(restoreEnvironment);
after(async () => {
  restoreEnvironment();
  if (viteServer) await viteServer.close();
});

test("configured public origin canonicalizes HTTPS tunnel requests", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  const { config, http } = await securityModules();
  const request = new Request("http://borabridge.com/api/auth/kakao", {
    headers: {
      origin: "https://borabridge.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(await config.effectiveRequestOrigin(request), "https://borabridge.com");
  assert.equal(await config.requireSameOrigin(request), true);
  assert.equal(await http.requestUsesHttps(request), true);
  assert.match(
    http.sessionCookie({
      token: "session-token",
      maxAgeSeconds: 900,
      secure: await http.requestUsesHttps(request),
    }),
    /;\s*Secure(?:;|$)/u,
  );
});

test("forwarded host cannot select the effective security origin", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  const { config } = await securityModules();
  const request = new Request("http://attacker.example/api/profile", {
    headers: {
      origin: "https://borabridge.com",
      "x-forwarded-host": "borabridge.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(await config.effectiveRequestOrigin(request), "http://attacker.example");
  assert.equal(await config.requireSameOrigin(request), false);
});

test("ambiguous proxy protocol and missing Origin fail closed", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  const { config } = await securityModules();
  const ambiguous = new Request("http://borabridge.com/api/profile", {
    headers: {
      origin: "https://borabridge.com",
      "x-forwarded-proto": "https,http",
    },
  });
  const missingOrigin = new Request("http://borabridge.com/api/profile", {
    headers: { "x-forwarded-proto": "https" },
  });

  assert.equal(await config.effectiveRequestOrigin(ambiguous), "http://borabridge.com");
  assert.equal(await config.requireSameOrigin(ambiguous), false);
  assert.equal(await config.requireSameOrigin(missingOrigin), false);
});

test("configured production origin does not replace a direct loopback origin", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  const { config, http } = await securityModules();
  const request = new Request("http://127.0.0.1:3000/api/profile", {
    headers: {
      origin: "http://127.0.0.1:3000",
      "x-forwarded-host": "borabridge.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(await config.effectiveRequestOrigin(request), "http://127.0.0.1:3000");
  assert.equal(await config.requireSameOrigin(request), true);
  assert.equal(await http.requestUsesHttps(request), false);
});

test("OAuth redirect URI uses the canonical public HTTPS origin", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  process.env.KAKAO_REDIRECT_URI =
    "https://borabridge.com/api/auth/callback/kakao";
  const { config } = await securityModules();
  const request = new Request("http://borabridge.com/api/auth/kakao", {
    headers: { "x-forwarded-proto": "https" },
  });

  assert.equal(
    await config.callbackUriForRequest(request, "kakao"),
    "https://borabridge.com/api/auth/callback/kakao",
  );
});

test("global headers enforce a compatible CSP and report against the stricter target", async () => {
  process.env.APP_BASE_URL = "https://borabridge.com";
  const { headers } = await securityModules();
  const tunnelRequest = new Request("http://borabridge.com/", {
    headers: { "x-forwarded-proto": "https" },
  });
  const secured = await headers.withGlobalSecurityHeaders(
    tunnelRequest,
    new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
  );

  assert.match(
    secured.headers.get("content-security-policy-report-only") ?? "",
    /frame-ancestors 'none'/u,
  );
  assert.match(
    secured.headers.get("content-security-policy") ?? "",
    /script-src 'self' 'unsafe-inline'/u,
  );
  assert.doesNotMatch(
    secured.headers.get("content-security-policy") ?? "",
    /unsafe-eval|localhost|127\.0\.0\.1/u,
  );
  assert.match(
    secured.headers.get("content-security-policy-report-only") ?? "",
    /script-src 'self';/u,
  );
  assert.doesNotMatch(
    secured.headers.get("content-security-policy-report-only") ?? "",
    /unsafe-inline|unsafe-eval/u,
  );
  assert.equal(secured.headers.get("x-frame-options"), "DENY");
  assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
  assert.equal(secured.headers.get("referrer-policy"), "no-referrer");
  assert.match(secured.headers.get("permissions-policy") ?? "", /payment=\(\)/u);
  assert.equal(
    secured.headers.get("strict-transport-security"),
    "max-age=31536000",
  );

  const local = await headers.withGlobalSecurityHeaders(
    new Request("http://127.0.0.1:3000/"),
    new Response("ok"),
  );
  assert.equal(local.headers.get("strict-transport-security"), null);
  assert.match(
    local.headers.get("content-security-policy") ?? "",
    /ws:\/\/127\.0\.0\.1:\*/u,
  );
});
