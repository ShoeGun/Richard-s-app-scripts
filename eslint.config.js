import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "worker/logs/**", "worker/runtime/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module"
    }
  },
  {
    files: ["worker/dashboard/**/*.js"],
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    files: ["script.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        Nivo: "readonly",
        Vizx: "readonly"
      }
    }
  },
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: tsPlugin.configs.recommended.rules
  }
];
