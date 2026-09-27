import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const projectRoot = process.cwd();
const envPath = resolve(projectRoot, process.argv[2] ?? ".env.local");
const baseConfigPath = resolve(
  projectRoot,
  process.argv[3] ?? "dist/server/wrangler.json",
);
const outputPath = resolve(
  projectRoot,
  process.argv[4] ?? "dist/server/wrangler.runtime.json",
);
const temporaryPath = `${outputPath}.${process.pid}.tmp`;

function dotenvValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseDotenv(source) {
  const values = {};
  for (const line of source.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    values[match[1]] = dotenvValue(match[2]);
  }
  return values;
}

const [environmentSource, baseConfigSource] = await Promise.all([
  readFile(envPath, "utf8"),
  readFile(baseConfigPath, "utf8"),
]);
const environment = parseDotenv(environmentSource);
const baseConfig = JSON.parse(baseConfigSource);
if (!baseConfig || typeof baseConfig !== "object" || Array.isArray(baseConfig)) {
  throw new Error("wrangler_base_config_invalid");
}

const baseConfigDirectory = dirname(baseConfigPath);
function configPath(value) {
  if (typeof value !== "string" || !value.trim()) return value;
  return isAbsolute(value) ? value : resolve(baseConfigDirectory, value);
}

const runtimeConfig = {
  ...baseConfig,
  main: configPath(baseConfig.main),
  ...(baseConfig.assets && typeof baseConfig.assets === "object" && !Array.isArray(baseConfig.assets)
    ? {
        assets: {
          ...baseConfig.assets,
          directory: configPath(baseConfig.assets.directory),
        },
      }
    : {}),
  ...(baseConfig.build && typeof baseConfig.build === "object" && !Array.isArray(baseConfig.build)
    ? {
        build: {
          ...baseConfig.build,
          watch_dir: configPath(baseConfig.build.watch_dir),
        },
      }
    : {}),
  vars: {
    ...(baseConfig.vars && typeof baseConfig.vars === "object" && !Array.isArray(baseConfig.vars)
      ? baseConfig.vars
      : {}),
    ...environment,
  },
};

await writeFile(temporaryPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporaryPath, outputPath);
await chmod(outputPath, 0o600);

// Never print variable names or values because this command runs in service logs.
process.stdout.write(`Prepared ${Object.keys(environment).length} local runtime bindings.\n`);
