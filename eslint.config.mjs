/**
 * Workspace-wide ESLint flat config, shared by the SDK, the indexer, and
 * the reference web app. Kept to the recommended TypeScript ruleset: the
 * strict type checking is done by tsc itself (strict, noUncheckedIndexedAccess).
 */

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
);
