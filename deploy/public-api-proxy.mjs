import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const UPSTREAM = "https://opendart.fss.or.kr/api/list.json";
const ALLOWED_PARAMETERS = new Set([
  "crtfc_key",
  "bgn_de",
  "end_de",
  "page_no",
  "page_count",
  "sort",
  "sort_mth",
]);
const token = String(process.env.PUBLIC_API_PROXY_TOKEN ?? "").trim();
const port = Number(process.env.PUBLIC_API_PROXY_PORT ?? "3101");
if (token.length < 32) throw new Error("PUBLIC_API_PROXY_TOKEN must contain at least 32 characters");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PUBLIC_API_PROXY_PORT is invalid");

class ClientError extends Error {
  constructor(status) {
    super("invalid_client_request");
    this.status = status;
  }
}

function authorized(value) {
  if (!value?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(value.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function json(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function validParameter(key, value) {
  if (key === "crtfc_key") return /^[A-Za-z0-9_-]{20,128}$/u.test(value);
  if (key === "bgn_de" || key === "end_de") return /^\d{8}$/u.test(value);
  if (key === "page_no") return /^\d{1,5}$/u.test(value) && Number(value) >= 1;
  if (key === "page_count") return /^\d{1,3}$/u.test(value) && Number(value) >= 1 && Number(value) <= 100;
  if (key === "sort") return ["date", "crp", "rpt"].includes(value);
  if (key === "sort_mth") return value === "asc" || value === "desc";
  return false;
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new ClientError(413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ClientError(400);
  }
}

let inFlight = false;
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/dart") {
    json(response, 404, { error: "not_found" });
    return;
  }
  if (!authorized(request.headers.authorization)) {
    json(response, 401, { error: "unauthorized" });
    return;
  }
  if (inFlight) {
    json(response, 503, { error: "busy" });
    return;
  }
  inFlight = true;
  try {
    const body = await requestBody(request);
    if (!body?.params || typeof body.params !== "object" || Array.isArray(body.params)) {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    const endpoint = new URL(UPSTREAM);
    for (const [key, rawValue] of Object.entries(body.params)) {
      if (!ALLOWED_PARAMETERS.has(key) || typeof rawValue !== "string" || !validParameter(key, rawValue)) {
        json(response, 400, { error: "invalid_parameter" });
        return;
      }
      endpoint.searchParams.set(key, rawValue);
    }
    if (!endpoint.searchParams.get("crtfc_key")) {
      json(response, 400, { error: "missing_credential" });
      return;
    }
    const upstream = await fetch(endpoint, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      json(response, 502, { error: "upstream_redirect_rejected" });
      return;
    }
    const payload = await upstream.text();
    if (payload.length > 2_000_000) {
      json(response, 502, { error: "upstream_response_too_large" });
      return;
    }
    response.writeHead(upstream.status, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-bora-proxy-upstream": "1",
      "x-content-type-options": "nosniff",
    });
    response.end(payload);
  } catch (error) {
    if (error instanceof ClientError) {
      json(response, error.status, { error: error.status === 413 ? "request_too_large" : "invalid_json" });
    } else {
      json(response, 502, { error: "upstream_unavailable" });
    }
  } finally {
    inFlight = false;
  }
});

server.requestTimeout = 25_000;
server.headersTimeout = 10_000;
server.listen(port, "127.0.0.1");
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
