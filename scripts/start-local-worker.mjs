import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { localWorkerOptions } from "./local-worker-options.mjs";

const MANAGED_SIGNALS = ["SIGINT", "SIGTERM"];

function parseOptions(argv) {
  const values = new Map();
  const allowed = new Set(["--config", "--persist-to", "--host", "--port"]);

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw new Error(`unsupported_option:${name ?? "missing"}`);
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${name}`);
    if (values.has(name)) throw new Error(`duplicate_option:${name}`);
    values.set(name, value);
  }

  return values;
}

function removeImportedSignalListeners(inherited) {
  for (const signal of MANAGED_SIGNALS) {
    const original = inherited.get(signal) ?? [];
    for (const listener of process.rawListeners(signal)) {
      if (!original.includes(listener)) process.removeListener(signal, listener);
    }
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const projectRoot = process.cwd();
  const configPath = resolve(
    projectRoot,
    options.get("--config") ?? "dist/server/wrangler.runtime.json",
  );
  const persistencePath = resolve(
    projectRoot,
    options.get("--persist-to") ?? ".wrangler/state",
  );
  const hostname = options.get("--host") ?? "127.0.0.1";
  const portText = options.get("--port") ?? "3000";
  const port = Number.parseInt(portText, 10);

  if (hostname !== "127.0.0.1") throw new Error("loopback_host_required");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535 || `${port}` !== portText) {
    throw new Error("invalid_port");
  }

  await Promise.all([
    access(configPath, constants.R_OK),
    access(persistencePath, constants.R_OK | constants.W_OK),
  ]);

  // Apply process-level controls before loading Wrangler. The generated
  // runtime config already contains application bindings, so dotenv loading is
  // explicitly disabled below.
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.NO_UPDATE_NOTIFIER = "1";

  const inheritedSignalListeners = new Map(
    MANAGED_SIGNALS.map((signal) => [signal, process.rawListeners(signal)]),
  );
  const { unstable_getMiniflareWorkerOptions: convertOptions } = await import("wrangler");
  // Use the Miniflare version pinned by Wrangler's lockfile, not a second
  // independently resolved runtime. No Wrangler development ProxyWorker sits
  // between incoming HTTP and the compiled app: early rejected request bodies
  // must not poison a later unrelated request on that development proxy.
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve("wrangler"));
  const { Miniflare, Log, LogLevel } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);

  // Wrangler's bundled CLI installs handlers that call process.exit()
  // immediately. Retain pre-existing handlers, but remove handlers added by
  // this import so local SQLite storage gets an orderly dispose on shutdown.
  removeImportedSignalListeners(inheritedSignalListeners);

  let worker;
  let workerPromise;
  let shutdownPromise;
  let finish;
  const finished = new Promise((resolveFinished) => {
    finish = resolveFinished;
  });

  function shutdown(reason, exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      process.stderr.write(`[bora-local-worker] stopping (${reason})\n`);
      process.exitCode = exitCode;

      let timeout;
      try {
        await Promise.race([
          (async () => {
            const runningWorker = worker ?? await workerPromise;
            await runningWorker?.dispose();
          })(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("dispose_timeout")), 15_000);
            timeout.unref();
          }),
        ]);
      } catch (error) {
        process.stderr.write(
          `[bora-local-worker] graceful stop failed: ${error instanceof Error ? error.message : "unknown"}\n`,
        );
        process.exitCode = 1;
      } finally {
        clearTimeout(timeout);
        finish();
      }
    })();

    return shutdownPromise;
  }

  // Keep the handlers installed while dispose() terminates Wrangler children;
  // a repeated propagated signal must not interrupt the SQLite-aware shutdown.
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    workerPromise = (async () => {
      const converted = convertOptions(configPath, undefined, {
        envFiles: [], overrides: { enableContainers: false },
      });
      const options = await localWorkerOptions(converted, { hostname, port, persistencePath });
      // inspectorPort is deliberately absent (disabled), and there is no
      // watcher, reload controller, remote mode, or background type generation.
      return new Miniflare({ ...options, log: new Log(LogLevel.WARN) });
    })();
    worker = await workerPromise;
    const url = await worker.ready;
    process.stdout.write(`[bora-local-worker] ready ${url.origin} (inspector disabled)\n`);
    await finished;
  } catch (error) {
    process.stderr.write(
      `[bora-local-worker] startup failed: ${error instanceof Error ? error.stack ?? error.message : "unknown"}\n`,
    );
    await shutdown("startup failure", 1);
  }
}

await main();
