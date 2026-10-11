import js from "@eslint/js";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";

// Correctness checks only (no formatting rules, no React Compiler policy).
export default [
  // Generated output, private tests/notes and static assets are not linted.
  {
    ignores: [
      "node_modules/**", "dist/**", "design/**", "docs/**", "public/**",
      ".local-backups/**", ".playwright-mcp/**", "tests/**", "**/*.test.js", "**/*.spec.js",
    ],
  },
  js.configs.recommended,
  // Server and scripts run in Node; `_`-prefixed arguments/errors may stay unused.
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // Frontend runs in the browser; hooks must be called unconditionally.
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": hooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
];
