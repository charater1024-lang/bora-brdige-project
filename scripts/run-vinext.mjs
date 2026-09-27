import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
