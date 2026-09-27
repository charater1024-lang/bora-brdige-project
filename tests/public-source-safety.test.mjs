import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkRepository, forbiddenPath, MAX_FILE_BYTES, scanContent } from "../scripts/check-public-source.mjs";

const script = fileURLToPath(new URL("../scripts/check-public-source.mjs", import.meta.url));
const installer = fileURLToPath(new URL("../scripts/install-git-hooks.mjs", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
const git = (cwd, args, input) => execFileSync("git", args, { cwd, input, env: cleanEnv, stdio: ["pipe", "pipe", "pipe"] }).toString();
const categories = findings => findings.map(finding => finding.category);
const credential = () => randomBytes(24).toString("hex");
const assigned = value => `const apiKey = ${JSON.stringify(value)};\n`;

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "bora-public-source-"));
  t.after(() => {
    assert.ok(cwd.startsWith(join(tmpdir(), "bora-public-source-")));
    rmSync(cwd, { recursive: true, force: true });
  });
  git(cwd, ["init", "--quiet"]);
  git(cwd, ["config", "user.name", "Publication guard test"]);
  git(cwd, ["config", "user.email", "guard@example.test"]);
  git(cwd, ["config", "core.autocrlf", "false"]);
  git(cwd, ["config", "core.hooksPath", ".unused-test-hooks"]);
  return cwd;
}

function stage(cwd, path, content) {
  const destination = join(cwd, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
  git(cwd, ["add", "--", path]);
}

function commit(cwd) { git(cwd, ["commit", "--quiet", "-m", "Synthetic fixture"]); }

function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env: cleanEnv, encoding: "utf8" });
}

test("targeted path rules reject runtime/credential data without banning source SQL or JSON", () => {
  for (const path of ["snapshot.boraenc", "snapshot.boraenc.json", "recovery-key.dpapi"]) {
    assert.equal(forbiddenPath(path), "encrypted-backup-or-recovery-key");
  }
  for (const path of [".env", ".env.local", "deploy/scheduler.env", "sub/.env.production", "a/.dev.vars", "data/production.sqlite-wal", "prod.db", "server.log.1", "deploy/credentials.json", "secrets.key", "id_ed25519", "model.gguf", "backup.tar.gz", "dump.sql", "export-2026.sql", "local-llm-server/.venv/bin/python", "sub/node_modules/a/index.js", "local-llm-server/runtime/config.json", "models/model.json", "dist/client.js", "work/report.md", "wrangler.runtime.json", "deploy/cloudflared-config.yml"]) {
    assert.ok(forbiddenPath(path), path);
  }
  for (const path of [".env.example", "local-llm-server/.env.example", "deploy/scheduler.env.example", "deploy/restart.env.template", "credentials.example.json", "drizzle/0001_migration.sql", "drizzle/meta/0001_snapshot.json", "evaluation/datasets/sample.json", "public/data/boundaries.json", "lib/runtime-settings.ts", "deploy/disable-work24.sql", "build/sites-vite-plugin.ts", "deploy/cloudflared-config.example.yml"]) {
    assert.equal(forbiddenPath(path), null, path);
  }
});

test("index scan reads staged blobs despite safe or missing working files", t => {
  const cwd = repository(t);
  stage(cwd, "config.mjs", assigned(credential()));
  writeFileSync(join(cwd, "config.mjs"), "// Working copy is clean.\n");
  assert.ok(categories(checkRepository({ cwd }).findings).includes("credential-literal"));
  rmSync(join(cwd, "config.mjs"));
  assert.ok(categories(checkRepository({ cwd }).findings).includes("credential-literal"));
});

test("unstaged/untracked secrets are excluded, committed source comes from Git", t => {
  const cwd = repository(t);
  stage(cwd, "source.mjs", "export const healthy = true;\n");
  commit(cwd);
  writeFileSync(join(cwd, "source.mjs"), assigned(credential()));
  writeFileSync(join(cwd, ".env"), assigned(credential()));
  assert.deepEqual(checkRepository({ cwd }).findings, []);
  assert.deepEqual(checkRepository({ cwd, mode: "ref", ref: "HEAD" }).findings, []);
});

test("invocation from a subdirectory still checks the complete index", t => {
  const cwd = repository(t);
  stage(cwd, "private.mjs", assigned(credential()));
  mkdirSync(join(cwd, "nested"));
  assert.ok(categories(checkRepository({ cwd: join(cwd, "nested") }).findings).includes("credential-literal"));
});

test("force-added ignored data is rejected by the validator independently of gitignore", t => {
  const cwd = repository(t);
  stage(cwd, ".gitignore", "*.db\n.env\n");
  writeFileSync(join(cwd, "production.db"), "not-even-a-real-database");
  git(cwd, ["add", "--force", "production.db"]);
  assert.ok(categories(checkRepository({ cwd }).findings).includes("database-file"));
});

test("deleted staged files are absent but history still catches committed-and-removed data", t => {
  const cwd = repository(t);
  stage(cwd, "private.mjs", assigned(credential()));
  stage(cwd, "safe.sql", "CREATE TABLE example (id INTEGER);\n");
  commit(cwd);
  git(cwd, ["rm", "--quiet", "private.mjs"]);
  assert.deepEqual(checkRepository({ cwd }).findings, []);
  commit(cwd);
  assert.deepEqual(checkRepository({ cwd, mode: "ref" }).findings, []);
  assert.ok(categories(checkRepository({ cwd, mode: "history" }).findings).includes("credential-literal"));
});

test("examples and tests are scanned; arbitrary fixture-looking provider tokens are not exempt", () => {
  const provider = ["ghp", randomBytes(24).toString("hex")].join("_");
  for (const path of [".env.example", "tests/fake.test.mjs", "docs/example.md"]) {
    assert.ok(categories(scanContent(path, Buffer.from(provider))).includes("github-token"));
    assert.ok(categories(scanContent(path, Buffer.from(assigned(credential())))).includes("credential-literal"));
  }
  assert.deepEqual(scanContent(".env.example", Buffer.from("API_KEY=\nCLIENT_SECRET=replace-with-random-value\n")), []);
  assert.deepEqual(scanContent("tests/fake.test.mjs", Buffer.from(assigned("test-publication-key"))), []);
});

test("known fixtures are exempt only at their exact reviewed value and path", () => {
  const synthetic = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  assert.deepEqual(scanContent("tests/judge-evaluation.test.mjs", Buffer.from(synthetic)), []);
  assert.ok(categories(scanContent("app/source.ts", Buffer.from(synthetic))).includes("aws-access-key"));
  const changed = synthetic.slice(0, -1) + "Z";
  assert.ok(categories(scanContent("tests/judge-evaluation.test.mjs", Buffer.from(changed))).includes("aws-access-key"));
});

test("private key, provider, credential URL, authorization and dotenv signatures", () => {
  const cases = [
    [["-----BEGIN", "PRIVATE KEY-----"].join(" "), "private-key"],
    [["sk", "proj", credential()].join("-"), "provider-api-key"],
    [["AIza", "a".repeat(35)].join(""), "google-api-key"],
    [["hf", "a".repeat(30)].join("_"), "huggingface-token"],
    [["npm", "a".repeat(36)].join("_"), "npm-token"],
    [`postgres://user:${credential()}@localhost/database`, "credential-url"],
    [`Bearer ${credential()}`, "authorization-literal"],
    [`SCHEDULER_SECRET=${credential()}\n`, "credential-literal"],
  ];
  for (const [content, category] of cases) assert.ok(categories(scanContent("source.txt", Buffer.from(content))).includes(category), category);
});

test("reviewed credential slot identifier does not exempt its file or other assignments", () => {
  const path = "app/api/public-data/import/seoul-commercial/route.ts";
  const value = ["SEOUL", "OPEN", "DATA", "API", "KEY"].join("_");
  const source = `const SERVICE_KEY = ${JSON.stringify(value)};`;
  assert.deepEqual(scanContent(path, Buffer.from(source)), []);
  assert.ok(categories(scanContent("app/other.ts", Buffer.from(source))).includes("credential-literal"));
  assert.ok(categories(scanContent(path, Buffer.from(assigned(value)))).includes("credential-literal"));
  assert.ok(categories(scanContent(path, Buffer.from(`const SERVICE_KEY = ${JSON.stringify(credential())};`))).includes("credential-literal"));
});

test("renamed database/archive and UTF-16 credentials cannot hide behind extensions", () => {
  assert.ok(categories(scanContent("innocent.txt", Buffer.from("SQLite format 3\0payload"))).includes("database-content"));
  assert.ok(categories(scanContent("innocent.txt", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).includes("archive-content"));
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(assigned(credential()), "utf16le")]);
  assert.ok(categories(scanContent("innocent.txt", utf16)).includes("credential-literal"));
  assert.deepEqual(scanContent("map.json", Buffer.from('{"location": [127, 37]}')), []);
});

test("unquoted YAML credentials and encoded public API query keys are inspected", () => {
  const value = credential();
  for (const source of [`LOCAL_LLM_API_KEY: ${value}\n`, `  - serviceKey: ${value}\n`, `  \"client_secret\": ${value}\n`]) {
    assert.ok(categories(scanContent("deploy/config.yaml", Buffer.from(source))).includes("credential-literal"));
  }
  for (const name of ["serviceKey", "authKey", "crtfc_key", "api_key", "access_token"]) {
    const encodedValue = [...value].map(character => `%${character.charCodeAt(0).toString(16)}`).join("");
    const url = `https://apis.example.test/data?%${name.charCodeAt(0).toString(16)}${name.slice(1)}=${encodedValue}&page=1`;
    assert.ok(categories(scanContent("docs/api.md", Buffer.from(url))).includes("credential-query"));
  }
  for (const source of ["https://example.test/data?serviceKey=YOUR_API_KEY&page=1", "https://example.test/data?region=seoul&title=public-policy", "API_KEY: ${PRIVATE_RUNTIME_KEY}\n", "API_KEY: replace-with-random-value\n"]) {
    assert.deepEqual(scanContent("docs/sample.md", Buffer.from(source)), []);
  }
});

test("personal mailbox and home paths are current-source guards, not a history rewrite claim", () => {
  const privateText = ["operator", "naver.com"].join("@") + "\n" + ["", "home", "operator-live", "app"].join("/");
  assert.deepEqual(categories(scanContent("README.md", Buffer.from(privateText))), ["personal-mailbox", "personal-home-path"]);
  assert.deepEqual(scanContent("README.md", Buffer.from(privateText), { includePrivacy: false }), []);
  assert.deepEqual(scanContent("deploy/sample.service", Buffer.from("/home/bora/app\n/home/example/app\ncontact@example.test")), []);
});

test("oversized blobs are rejected before content is loaded", t => {
  const cwd = repository(t);
  stage(cwd, "large.dat", Buffer.alloc(MAX_FILE_BYTES + 1, 65));
  assert.ok(categories(checkRepository({ cwd }).findings).includes("file-size-limit"));
});

test("snapshot total counts repeated blobs at every tracked path", t => {
  const cwd = repository(t);
  const oid = git(cwd, ["hash-object", "-w", "--stdin"], Buffer.alloc(MAX_FILE_BYTES, 65)).trim();
  git(cwd, ["update-index", "--index-info"], Array.from({ length: 21 }, (_, index) => `100644 ${oid}\tasset-${index}.dat\n`).join(""));
  assert.ok(categories(checkRepository({ cwd }).findings).includes("snapshot-size-limit"));
});

test("symlinks and submodules fail closed instead of silently skipping content", t => {
  const cwd = repository(t);
  const oid = git(cwd, ["hash-object", "-w", "--stdin"], "outside-source").trim();
  git(cwd, ["update-index", "--add", "--cacheinfo", `120000,${oid},symlink.txt`]);
  assert.ok(categories(checkRepository({ cwd }).findings).includes("unscanned-symlink-or-submodule"));
});

test("CLI diagnostics give only escaped path, line and category, never credential content", t => {
  const cwd = repository(t);
  const value = credential();
  stage(cwd, "config.mjs", "// public line\n" + assigned(value));
  const result = run(cwd, "--staged");
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('"config.mjs":2 credential-literal'));
  assert.equal((result.stdout + result.stderr).includes(value), false);
  assert.equal(result.stderr.includes("const apiKey"), false);
  const invalid = run(cwd, "--ref", "not-a-real-ref");
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stderr.includes("not-a-real-ref"), false);
});

test("ignore rules cover accidental artifacts but preserve migration/template source", t => {
  const cwd = repository(t);
  writeFileSync(join(cwd, ".gitignore"), readFileSync(join(root, ".gitignore")));
  const denied = ["deploy/scheduler.env", "production.sqlite", "data/production.db", "deployment.log", "dump.sql", "secrets.key", "local-llm-server/.venv/bin/python", "deploy/credentials.json"];
  for (const path of denied) assert.equal(spawnSync("git", ["check-ignore", "--quiet", "--no-index", path], { cwd, env: cleanEnv }).status, 0, path);
  for (const path of [".env.example", "deploy/scheduler.env.example", "drizzle/0001.sql", "public/data/map.json"]) assert.equal(spawnSync("git", ["check-ignore", "--quiet", "--no-index", path], { cwd, env: cleanEnv }).status, 1, path);
});

test("installer refuses to overwrite existing hook configuration", t => {
  const cwd = repository(t);
  const result = spawnSync(process.execPath, [installer], { cwd, env: cleanEnv, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(git(cwd, ["config", "--get", "core.hooksPath"]).trim(), ".unused-test-hooks");
});

test("installer preserves an existing default pre-commit hook", t => {
  const cwd = repository(t);
  git(cwd, ["config", "--unset", "core.hooksPath"]);
  writeFileSync(join(cwd, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  const result = spawnSync(process.execPath, [installer], { cwd, env: cleanEnv, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(readFileSync(join(cwd, ".git", "hooks", "pre-commit"), "utf8"), "#!/bin/sh\nexit 0\n");
});

test("guard source, tests and CI are themselves safe to publish", () => {
  for (const path of ["scripts/check-public-source.mjs", "scripts/install-git-hooks.mjs", "tests/public-source-safety.test.mjs", ".github/workflows/public-source-safety.yml", ".githooks/pre-commit"]) {
    assert.deepEqual(scanContent(path, readFileSync(join(root, path))), [], path);
  }
  const workflow = readFileSync(join(root, ".github/workflows/public-source-safety.yml"), "utf8");
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.doesNotMatch(workflow, /\n\s+pull_request_target:/u);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
  for (const match of workflow.matchAll(/uses: (\S+)/gu)) assert.match(match[1], /@[a-f0-9]{40}$/u);
});
