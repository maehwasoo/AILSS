// ESLint 설정(flat config)
// - TypeScript + Node.js(ESM) 기준
// - 포맷 규칙은 Prettier로 위임

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  // 빌드 산출물/캐시/외부 의존성 제외
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
    ],
  },

  // 기본 추천 규칙
  js.configs.recommended,

  // TypeScript 추천 규칙
  ...tseslint.configs.recommended,

  // 런타임 전역(global) 정의
  {
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      // TS 프로젝트에서는 TS 버전 규칙만 사용
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

  // Prettier와 충돌하는 lint 규칙 비활성화
  prettier,
];
