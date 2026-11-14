import tseslint from 'typescript-eslint';

// Restore the missing lint bootstrap without adding style rules or changing
// the production compiler's scope.
export default [
  {ignores:['**/*.spec.ts','**/*.test.ts','**/__tests__/**','node_modules/**','dist/**','test/**',
    '**/*test-runner*.ts','**/*.prisma-e2e-spec.ts','**/*-spec.ts']},
  {files:['src/**/*.ts'],languageOptions:{parser:tseslint.parser},
    plugins:{'@typescript-eslint':tseslint.plugin},rules:{
    'no-async-promise-executor':'error',
    'no-dupe-args':'error',
    'no-duplicate-case':'error',
    'no-unreachable':'error',
    'no-unsafe-finally':'error',
    'no-this-before-super':'error',
    'valid-typeof':'error',
  }},
];
