import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local audits, exports and runtime output are not application source.
    "dist/**",
    "work/**",
    "output/**",
    "outputs/**",
    "tmp/**",
    ".wrangler/**",
    ".deploy-*/**",
    "**/.venv/**",
    ".pnpm-store/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
