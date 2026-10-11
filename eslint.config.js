import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

// Correctness checks without imposing a new formatting or React compiler policy.
export default [
  {ignores:['node_modules/**','dist/**','design/**','docs/**','public/**','.local-backups/**','.playwright-mcp/**','tests/**','**/*.test.js','**/*.spec.js']},
  js.configs.recommended,
  {files:['**/*.{js,mjs,jsx}'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.node},
    rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_'}]}},
  {files:['src/**/*.{js,jsx}'],languageOptions:{globals:globals.browser,parserOptions:{ecmaFeatures:{jsx:true}}},
    plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error'}},
];
