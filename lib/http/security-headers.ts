import { requestUsesHttps } from "../auth/http";

const CONTENT_SECURITY_POLICY_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

export const CONTENT_SECURITY_POLICY = [
  ...CONTENT_SECURITY_POLICY_BASE,
  // The current React/Vinext document bootstrap contains inline scripts and
  // styles. Keep those two compatibility exceptions in the enforced policy,
  // but do not allow eval or browser connections to arbitrary HTTPS origins.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const LOCAL_CONTENT_SECURITY_POLICY = [
  ...CONTENT_SECURITY_POLICY_BASE,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "frame-src 'self' https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  ...CONTENT_SECURITY_POLICY_BASE,
  // This is the target policy. It deliberately reports the remaining inline
  // framework bootstrap so nonce/hash coverage can be completed before these
  // compatibility exceptions are removed from the enforced policy.
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "require-trusted-types-for 'script'",
].join("; ");

const GLOBAL_SECURITY_HEADERS = {
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export async function withGlobalSecurityHeaders(
  request: Request,
  response: Response,
): Promise<Response> {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(GLOBAL_SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  const https = await requestUsesHttps(request);
  if (!secured.headers.has("Content-Security-Policy")) {
    secured.headers.set(
      "Content-Security-Policy",
      https ? CONTENT_SECURITY_POLICY : LOCAL_CONTENT_SECURITY_POLICY,
    );
  }
  if (!secured.headers.has("Content-Security-Policy-Report-Only")) {
    secured.headers.set(
      "Content-Security-Policy-Report-Only",
      CONTENT_SECURITY_POLICY_REPORT_ONLY,
    );
  }
  if (https) {
    secured.headers.set("Strict-Transport-Security", "max-age=31536000");
  } else {
    secured.headers.delete("Strict-Transport-Security");
  }
  return secured;
}
