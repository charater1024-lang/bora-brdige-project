import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This is a publication guard, not proof that source contains no secrets/PII.
// No network, dependencies, working-file reads, secret values or snippets in
// diagnostics. Never exempt whole test/example directories from inspection.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const BATCH_BYTES = 8 * 1024 * 1024;

export function forbiddenPath(path) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const base = normalized.split("/").at(-1);
  if (/(?:^|\/)(?:node_modules|\.pnpm-store|\.next|\.vinext|\.vite|\.wrangler|\.venv|venv|__pycache__|\.cache|\.ssh|\.aws|\.gnupg|runtime|logs?|backups?|checkpoints?|models?)(?:\/|$)/u.test(normalized)) return "runtime-path";
  if (/^(?:dist|out|output|outputs|work|tmp|coverage|job_application_work|\.deploy-backups|\.deploy-stage[^/]*|\.dist-[^/]*|\.seoul-[^/]*|\.sites-index[^/]*)(?:\/|$)/u.test(normalized)) return "runtime-path";
  const envSample = /(?:^|\.)env(?:\.[^.]+)*\.(?:example|sample|template)$/u.test(base);
  if (!envSample && (/^\.env(?:\.|$)/u.test(base) || /\.env(?:\.|$)/u.test(base) || /^\.dev\.vars(?:\.|$)/u.test(base))) return "live-environment";
  if (normalized === "deploy/cloudflared-config.yml" || /\.runtime\.json$/u.test(base)) return "live-runtime-config";
  if (/\.(?:db|sqlite3?)(?:[-.].*)?$/u.test(base)) return "database-file";
  if (/\.(?:log)(?:\..*)?$/u.test(base)) return "log-file";
  if (/\.(?:pem|key|p12|pfx|ppk)$/u.test(base) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/u.test(base)) return "private-key-file";
  if (/\.(?:boraenc)(?:\..*)?$/u.test(base) || /\.dpapi$/u.test(base)) return "encrypted-backup-or-recovery-key";
  if (/\.(?:gguf|safetensors|ckpt|pt|pth|onnx|bin)$/u.test(base)) return "model-or-binary-file";
  if (/\.(?:zip|tar|tgz|gz|7z|rar|bz2|xz|bak|dump)$/u.test(base) || /^(?:dump|backup|export)(?:[-_.].*)?\.sql$/u.test(base)) return "archive-or-dump";
  if (/^(?:credentials|secrets|service-account)(?:[._-].*)?\.json$/u.test(base) && !/\.(?:example|sample|template)\.json$/u.test(base)) return "credential-file";
  return null;
}

function placeholder(value) {
  return value.length === 0 || /^(?:<[^>]+>|\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|x{4,}|\*{4,}|0{4,}|\.{3}|changeme|redacted)$/iu.test(value)
    || /^(?:your|replace|change|example|sample|test|dummy|mock|fake|placeholder|not-real)(?:[-_ ][a-z0-9]+)+$/iu.test(value);
}

// Existing negative/security tests use a few deliberately malformed fixtures.
// Reviewed 2026-09-23: exact value SHA-256 + exact path only, never a whole file
// exemption or an inline suppression marker. New signature fixtures should be
// assembled at runtime. Changing/adding even one character is NOT exempt.
const reviewedFixtures = new Map(Object.entries({
  "tests/bizinfo-backfill.test.mjs": [
    "053fccbf63f934e5233972601b5130134132d64634928b4ee055460535dc7f6e",
    "a8d95d2e314459924284bc0fa0d794d4057c5104b31e8a2ed96b3047539e5958",
  ],
  "tests/seoul-commercial-adapter.test.mjs": ["fe7c4f181e9f97a30ac0dd0d45395c08b002a0c0f25b82540fe8601dbe389a4c"],
  "tests/startup-adapters.test.mjs": ["414b96fb87c8c20e3b1b4be3de1f6c6bb6f212d2c143850fd8f375301f7e0653"],
  "tests/request-security.test.mjs": ["c101e911469c969171040b50d70543313cf968fdef5bacc780776f8fb399ab36"],
  "tests/rendered-html.test.mjs": ["d6309e49ddf6743f89aed50e163da10d8ee595c5e28b3ff3b03c8813707be2eb"],
  "tests/local-runtime-config.test.mjs": ["d86ad0636f6162e56a69a77d30fb863c8ddefa891b356fb6600dd5566f80f762"],
  "tests/kosis-employment-adapter.test.mjs": [
    "bcb8a779dfc9849dfbabb462fa3c7addec820827151f5f51ff3c51a2811d0af7",
    "2cb07eca80d68351d9da8cbc968fad2799aefe231c519cac5eefbcc5e403f6ce",
    "9e482c55bd22a9087d3066e3b37d10df41aa58d773797ff71ecf8f2bb4a9fc16",
    "2f6af30073d1af8ae6a81c171d95797c8412cc3668c52b5e393eec45d6971002",
    "18e48058af92fa61d7be47502102c6e8d8d3a5d085d5ff1ce8ab31474877f3e0",
    "9ba28b4799fff656bb2fd4ac59612cb8ccfdcc172134b4c7e21472eea4495ec7",
    "1c59351772e6255d93ed4b641cabfc9f8becdd92c55544a4ee7cc9e543c61786",
  ],
  "tests/rag-evidence-ui.test.mjs": ["b0d9ce7fd3726b06ec0b269140116714c16a0a82267d4bb308ee77661e9a1213"],
  "tests/judge-evaluation.test.mjs": [
    "c3b3426a7c1303bcb6a90fbad6126113e7e77f8a7d4e80c2b3454dbe3ddefea6",
    "ae8754608195aafb81001fbdb911f6019eb8b13fa6e5ef7229ea71b0b9a7f976",
    "457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3",
    "691223dce5de78a6c13f9638dd06fb150c04e2007779e6deaaaa1a1c40779353",
    "17d77221c978e8b0ec5a4a651f3ea2f873665baacdb3cb2eebc07f74f76096b6",
  ],
}));

function reviewedFixture(path, value) {
  const hashes = reviewedFixtures.get(path);
  return hashes?.includes(createHash("sha256").update(value).digest("hex")) ?? false;
}

function credentialLiteral(value) {
  // Descriptive UI labels (e.g. Korean text in an API-name -> label map) are
  // not credential-shaped. Provider signatures are checked independently.
  return value.length >= 8 && /^[\x21-\x7e]+$/u.test(value) && !value.includes("${") && !placeholder(value);
}

function reviewedPublicIdentifier(path, name, value) {
  // This importer names the runtime credential lookup slot; it does not embed
  // the credential. Keep this exemption exact in path, assignment and value.
  return path === "app/api/public-data/import/seoul-commercial/route.ts"
    && name === "SERVICE_KEY" && value === "SEOUL_OPEN_DATA_API_KEY";
}

const signatures = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{35}\b/gu],
  ["provider-api-key", /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}\b/gu],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/gu],
  ["oauth-token", /\bya29\.[A-Za-z0-9_-]{20,}\b/gu],
  ["huggingface-token", /\bhf_[A-Za-z0-9]{20,}\b/gu],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}\b/gu],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/gu],
  ["sendgrid-key", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu],
  ["stripe-secret", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/gu],
  ["jwt-literal", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu],
];

function isCredentialName(name) {
  return /^(?:api[_-]?key|service[_-]?key|auth[_-]?key|crtfc_key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|auth[_-]?token|_authToken|_auth)$/iu.test(name)
    || /(?:api[_-]?key|api[_-]?token|client[_-]?secret|tunnel[_-]?secret|secret[_-]?key|admin[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|signing[_-]?key|encryption[_-]?key|_secret|_token)$/iu.test(name);
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const copy = Buffer.from(buffer.subarray(2));
    if (copy.length % 2 === 0) return copy.swap16().toString("utf16le");
  }
  return buffer.toString("utf8");
}

export function scanContent(path, buffer, { includePrivacy = true } = {}) {
  const findings = [];
  const add = (line, category) => findings.push({ path, line, category });
  const magic = buffer.subarray(0, 16).toString("latin1");
  if (magic.startsWith("SQLite format 3\0")) add(1, "database-content");
  if (magic.startsWith("GGUF")) add(1, "model-content");
  if (/^(?:PK\x03\x04|PK\x05\x06|\x1f\x8b|7z\xbc\xaf\x27\x1c|Rar!)/u.test(magic) || buffer.subarray(257, 262).toString() === "ustar") add(1, "archive-content");
  const text = decodeText(buffer);
  if (text.startsWith("version https://git-lfs.github.com/spec/v1\n")) add(1, "unscanned-lfs-pointer");
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (includePrivacy) {
      if (/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail|naver|daum|kakao|outlook|hotmail)\.com\b/iu.test(line)) add(index + 1, "personal-mailbox");
      for (const match of line.matchAll(/\/home\/([a-z_][a-z0-9_.-]*)(?=\/|\b)/giu)) {
        if (!["bora", "example", "user", "username", "test", "runner"].includes(match[1].toLowerCase())) add(index + 1, "personal-home-path");
      }
    }
    for (const [category, pattern] of signatures) {
      // Recognizable signatures are inspected even in samples/tests.
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        if (!reviewedFixture(path, match[0])) add(index + 1, category);
      }
    }
    for (const match of line.matchAll(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/([^\s\/:@]+):([^\s\/@]+)@[^\s"'`<>]+/giu)) {
      if (!placeholder(match[2]) && !reviewedFixture(path, match[0])) add(index + 1, "credential-url");
    }
    for (const match of line.matchAll(/\b(?:Bearer|Basic)\s+([A-Za-z0-9+/_=-]{16,})/gu)) {
      if (!placeholder(match[1])) add(index + 1, "authorization-literal");
    }
    // Public-data API keys often have no provider prefix. URLSearchParams
    // decodes both names and values, including percent-encoded serviceKey.
    for (const match of line.matchAll(/\bhttps?:\/\/[^\s"'`<>]+/giu)) {
      let url;
      try { url = new URL(match[0].replaceAll("&amp;", "&")); } catch { continue; }
      for (const [name, value] of url.searchParams) {
        if ((isCredentialName(name) || name.toLowerCase() === "key")
          && credentialLiteral(value) && !reviewedFixture(path, value)
          && !reviewedFixture(path, match[0])) add(index + 1, "credential-query");
      }
    }
    // Literal assignments in JS/TS/JSON/Python/YAML and dotenv. References,
    // templates and computed runtime values are not credentials in source.
    for (const match of line.matchAll(/\b([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(["'`])([^"'`\r\n]*)\2/gu)) {
      if (!isCredentialName(match[1])) continue;
      const value = match[3];
      if (credentialLiteral(value) && !reviewedFixture(path, value)
        && !reviewedPublicIdentifier(path, match[1], value)) add(index + 1, "credential-literal");
    }
    const env = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\s"'`#][^\s#]*)/u);
    if (env && isCredentialName(env[1]) && env[2].length >= 8 && !placeholder(env[2]) && !/^(?:process\.|env\.|os\.|await\b|[a-zA-Z_$][\w.$]*\(|[a-zA-Z_$][\w.$]*[;,])/.test(env[2])) add(index + 1, "credential-literal");
    const yaml = /\.(?:ya?ml|md|txt)$/iu.test(path)
      ? line.match(/^\s*(?:-\s*)?["']?([A-Za-z_][\w.-]*)["']?\s*:\s*([^\s"'`\[\]{},#|>][^\s#]*)/u) : null;
    if (yaml && isCredentialName(yaml[1]) && credentialLiteral(yaml[2])
      && !reviewedFixture(path, yaml[2])) add(index + 1, "credential-literal");
  }
  return findings.filter((finding, index, all) => all.findIndex(other => other.line === finding.line && other.category === finding.category) === index);
}

function git(cwd, args, input, maxBuffer = 32 * 1024 * 1024) {
  return execFileSync("git", args, { cwd, input, maxBuffer, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" } });
}

function parseEntries(output, staged) {
  return output.toString("utf8").split("\0").filter(Boolean).map(record => {
    const match = staged
      ? record.match(/^(\d+) ([a-f0-9]+) (\d+)\t([\s\S]+)$/u)
      : record.match(/^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/u);
    if (!match) throw new Error("invalid Git entry");
    return { mode: match[1], oid: match[staged ? 2 : 3], path: match[4], stage: staged ? Number(match[3]) : 0 };
  });
}

export function checkRepository({ cwd = process.cwd(), mode = "staged", ref = "HEAD", all = false } = {}) {
  if (!["staged", "ref", "history"].includes(mode) || (all && mode !== "history")) throw new Error("invalid scan mode");
  // ls-files otherwise limits discovery to the caller's subdirectory.
  cwd = git(cwd, ["rev-parse", "--show-toplevel"]).toString().trim();
  const snapshots = [];
  if (mode === "staged") {
    snapshots.push(parseEntries(git(cwd, ["ls-files", "--stage", "-z", "--full-name"]), true));
  } else {
    if (mode === "history" && git(cwd, ["rev-parse", "--is-shallow-repository"]).toString().trim() === "true") throw new Error("history needs full clone");
    const commit = all ? null : git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString().trim();
    const commits = mode === "history" ? git(cwd, ["rev-list", ...(all ? ["--all"] : [commit])]).toString().trim().split("\n").filter(Boolean) : [commit];
    for (const oid of commits) snapshots.push(parseEntries(git(cwd, ["ls-tree", "-rz", "--full-tree", oid]), false));
  }
  const entries = [...new Map(snapshots.flat().map(entry => [`${entry.mode}:${entry.oid}:${entry.path}:${entry.stage}`, entry])).values()];
  const findings = [];
  const regular = entries.filter(entry => /^100(?:644|755)$/u.test(entry.mode) && entry.stage === 0);
  for (const entry of entries) {
    const category = forbiddenPath(entry.path);
    if (category) findings.push({ path: entry.path, line: 1, category });
    if (entry.stage !== 0) findings.push({ path: entry.path, line: 1, category: "unmerged-index" });
    if (!/^100(?:644|755)$/u.test(entry.mode)) findings.push({ path: entry.path, line: 1, category: "unscanned-symlink-or-submodule" });
  }
  const oids = [...new Set(regular.map(entry => entry.oid))];
  const sizes = new Map();
  if (oids.length) {
    const output = git(cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], oids.join("\n") + "\n").toString();
    for (const line of output.trim().split("\n")) {
      const match = line.match(/^([a-f0-9]+) blob (\d+)$/u);
      if (!match) throw new Error("missing Git blob");
      sizes.set(match[1], Number(match[2]));
    }
  }
  for (const snapshot of snapshots) {
    const size = snapshot.reduce((sum, entry) => sum + (sizes.get(entry.oid) ?? 0), 0);
    if (size > MAX_SNAPSHOT_BYTES) findings.push({ path: "<repository>", line: 1, category: "snapshot-size-limit" });
  }
  const byOid = new Map();
  for (const entry of regular) {
    if (sizes.get(entry.oid) > MAX_FILE_BYTES) {
      findings.push({ path: entry.path, line: 1, category: "file-size-limit" });
    } else {
      if (!byOid.has(entry.oid)) byOid.set(entry.oid, []);
      byOid.get(entry.oid).push(entry.path);
    }
  }
  let batch = [], batchSize = 0;
  function scanBatch() {
    if (!batch.length) return;
    const output = git(cwd, ["cat-file", "--batch"], batch.join("\n") + "\n", batchSize + batch.length * 128 + 1024);
    let offset = 0;
    for (const oid of batch) {
      const end = output.indexOf(10, offset);
      const expected = `${oid} blob ${sizes.get(oid)}`;
      if (end === -1 || output.subarray(offset, end).toString() !== expected) throw new Error("invalid Git blob response");
      const start = end + 1, size = sizes.get(oid);
      if (output[start + size] !== 10) throw new Error("truncated Git blob");
      // Historical privacy metadata is retained intentionally; current-source
      // publication checks are strict, but do not pretend history was rewritten.
      for (const path of byOid.get(oid)) findings.push(...scanContent(path, output.subarray(start, start + size), { includePrivacy: mode !== "history" }));
      offset = start + size + 1;
    }
    if (offset !== output.length) throw new Error("unconsumed Git output");
    batch = [];
    batchSize = 0;
  }
  for (const oid of byOid.keys()) {
    const size = sizes.get(oid);
    if (batchSize + size > BATCH_BYTES) scanBatch();
    batch.push(oid);
    batchSize += size;
  }
  scanBatch();
  const unique = [...new Map(findings.map(finding => [`${finding.path}:${finding.line}:${finding.category}`, finding])).values()];
  return { findings: unique.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.category.localeCompare(b.category)), snapshots: snapshots.length, files: entries.length, blobs: byOid.size };
}

function main(args) {
  let mode = "staged", ref = "HEAD", all = false, chosen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--all") { all = true; continue; }
    if (!["--staged", "--ref", "--history"].includes(arg) || chosen) throw new Error("invalid arguments");
    chosen = true;
    mode = arg.slice(2);
    if (arg === "--ref" || (arg === "--history" && args[index + 1] && !args[index + 1].startsWith("--"))) {
      ref = args[++index];
      if (!ref || ref.startsWith("-")) throw new Error("missing ref");
    }
  }
  if (all && mode !== "history") throw new Error("all needs history");
  const result = checkRepository({ mode, ref, all });
  for (const finding of result.findings) {
    // JSON escaping prevents path names from injecting terminal/CI commands.
    console.error(`${JSON.stringify(finding.path)}:${finding.line} ${finding.category}`);
  }
  if (result.findings.length) {
    console.error(`Public source check failed: ${result.findings.length} finding(s). No content values are shown.`);
    process.exitCode = 1;
  } else {
    console.log(`Public source check passed: ${result.snapshots} snapshot(s), ${result.files} path-version(s), ${result.blobs} blob(s).${mode === "history" ? " History scope: credentials/runtime, not legacy personal metadata." : ""}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch {
    console.error("Public source check could not complete (Git/ref/arguments/history). Failing closed; no content values are shown.");
    process.exitCode = 2;
  }
}
