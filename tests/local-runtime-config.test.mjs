import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const runtimeConfigScript = fileURLToPath(
  new URL("../scripts/build-local-runtime-config.mjs", import.meta.url),
);

test("local runtime config moves env-file values into Worker bindings without logging secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bora-runtime-config-"));
  const envPath = join(directory, ".env.local");
  const basePath = join(directory, "wrangler.json");
  const outputPath = join(directory, "wrangler.runtime.json");
  const secret = "must-not-appear-in-service-logs";

  await Promise.all([
    writeFile(envPath, [
      "AUTH_MODE=external",
      "APP_BASE_URL=https://borabridge.com",
      `NAVER_CLIENT_SECRET=${secret}`,
      "EMPTY_VALUE=",
    ].join("\n"), "utf8"),
    writeFile(basePath, JSON.stringify({
      name: "bora-bridge",
      main: "index.js",
      dev: { ip: "127.0.0.1" },
      assets: { directory: "../client" },
      build: { watch_dir: "./src" },
      vars: { EXISTING_VALUE: "kept" },
    }), "utf8"),
  ]);

  const { stdout, stderr } = await run(
    process.execPath,
    [
      runtimeConfigScript,
      envPath,
      basePath,
      outputPath,
    ],
    { cwd: directory },
  );
  const generated = JSON.parse(await readFile(outputPath, "utf8"));
  const metadata = await stat(outputPath);

  assert.equal(generated.vars.AUTH_MODE, "external");
  assert.equal(generated.vars.APP_BASE_URL, "https://borabridge.com");
  assert.equal(generated.vars.NAVER_CLIENT_SECRET, secret);
  assert.equal(generated.vars.EMPTY_VALUE, "");
  assert.equal(generated.vars.EXISTING_VALUE, "kept");
  assert.equal(generated.dev.ip, "127.0.0.1");
  assert.equal(generated.dev.inspector, undefined);
  assert.equal(generated.main, join(directory, "index.js"));
  assert.equal(generated.assets.directory, join(directory, "..", "client"));
  assert.equal(generated.build.watch_dir, join(directory, "src"));
  assert.doesNotMatch(stdout, new RegExp(secret, "u"));
  assert.doesNotMatch(stderr, new RegExp(secret, "u"));
  if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
});

test("the user service generates the private runtime config outside the app sandbox", async () => {
  const [service, wrapper] = await Promise.all([
    readFile(new URL("../deploy/bora-bridge.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/run-bora-sandbox.sh", import.meta.url), "utf8"),
  ]);
  assert.match(service, /ExecStartPre=.*build-local-runtime-config\.mjs/u);
  assert.match(service, /RuntimeDirectory=bora-bridge/u);
  assert.match(service, /%t\/bora-bridge\/wrangler\.runtime\.json/u);
  assert.match(service, /ExecStart=\/usr\/bin\/bash deploy\/run-bora-sandbox\.sh/u);
  assert.doesNotMatch(service, /--env-file/u);
  assert.match(wrapper, /RUNTIME_DIR=.*\/bora-bridge/u);
  assert.match(
    wrapper,
    /DEFAULT_RUNTIME_CONFIG="\$\{RUNTIME_DIR\}\/wrangler\.runtime\.json"/u,
  );
  assert.match(wrapper, /CANARY_RUNTIME_CONFIG=.*canary-wrangler\.runtime\.json/u);
  assert.match(wrapper, /BORA_RUNTIME_CONFIG/u);
  assert.match(wrapper, /scripts\/start-local-worker[.]mjs/u);
  assert.doesNotMatch(wrapper, /wrangler(?:[.]js)?["']? dev/u);
  assert.match(wrapper, /dist\/server\/wrangler\.runtime\.json/u);
  assert.match(wrapper, /--ro-bind \/dev\/null/u);
});

test("Local LLM user services survive reboot and keep their runtime outside deployments", async () => {
  const [ollamaService, gatewayService, installer, gateway] = await Promise.all([
    readFile(new URL("../deploy/bora-ollama.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/bora-local-llm.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/install-local-llm-user-services.sh", import.meta.url), "utf8"),
    readFile(new URL("../local-llm-server/app.py", import.meta.url), "utf8"),
  ]);
  for (const service of [ollamaService, gatewayService]) {
    assert.match(service, /WantedBy=default\.target/u);
    assert.match(service, /Restart=always/u);
    assert.match(service, /StartLimitIntervalSec=0/u);
  }
  assert.match(ollamaService, /OLLAMA_HOST=127\.0\.0\.1:11434/u);
  assert.match(
    gatewayService,
    /ExecStart=%h\/\.local\/share\/bora-bridge\/local-llm-venv\/bin\/python/u,
  );
  assert.doesNotMatch(gatewayService, /local-llm-server\/\.venv\/bin\/python/u);
  assert.match(installer, /systemctl --user enable bora-ollama\.service bora-local-llm\.service/u);
  assert.match(installer, /systemctl --user restart bora-ollama\.service/u);
  assert.match(installer, /systemctl --user restart bora-local-llm\.service/u);
  assert.match(installer, /http:\/\/127\.0\.0\.1:11435\/health/u);
  assert.match(gateway, /LOCAL_LLM_AUTOLOAD/u);
  assert.match(gateway, /manager\.request_activation\(manager\.selected_model\)/u);
});
