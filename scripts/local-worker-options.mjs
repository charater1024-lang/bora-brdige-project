import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

// Vinext emits dynamic import expressions. Explicitly enumerate the immutable
// built modules instead of asking Miniflare to statically walk those imports.
export async function localWorkerOptions(converted, { hostname, port, persistencePath }) {
  if (hostname !== "127.0.0.1") throw new Error("loopback_host_required");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid_port");
  if (!isAbsolute(persistencePath) || typeof converted.main !== "string" || !isAbsolute(converted.main)) {
    throw new Error("absolute_runtime_paths_required");
  }
  const root = dirname(converted.main);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("bundle_symlink_refused");
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:m?js)$/u.test(entry.name)) files.push(path);
    }
  }
  if ((await lstat(root)).isSymbolicLink()) throw new Error("bundle_symlink_refused");
  await visit(root);
  if (!files.includes(converted.main)) throw new Error("compiled_entry_missing");
  const modules = [converted.main, ...files.filter((file) => file !== converted.main).sort()]
    .map((path) => ({ type: "ESModule", path }));
  return {
    host: hostname, port, cf: false,
    // Preserve Wrangler's exact v3 D1 namespace/path. Changing this silently
    // creates a different DB instead of opening the existing user database.
    d1Persist: resolve(persistencePath, "v3/d1"),
    kvPersist: resolve(persistencePath, "v3/kv"),
    r2Persist: resolve(persistencePath, "v3/r2"),
    durableObjectsPersist: resolve(persistencePath, "v3/do"),
    workers: [{ ...converted.workerOptions, modules, modulesRoot: root }, ...converted.externalWorkers],
  };
}
