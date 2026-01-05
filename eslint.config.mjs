// ESLint configuration (flat config)
// - TypeScript + Node.js (ESM)
// - Formatting rules delegated to Prettier

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  // Exclude build outputs/caches/external dependencies
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".pnpm-store/**",
      ".npm-cache/**",
      ".node-gyp/**",
      ".ailss/**",
      "**/*.d.ts",
      "**/*.d.ts.map",
      "**/*.js.map",
      "packages/obsidian-plugin/main.js",
    ],
  },

  // Base recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Runtime globals
  {
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      // Prefer TS-aware unused-vars checks in TS projects
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Disable lint rules that conflict with Prettier
  prettier,
];
