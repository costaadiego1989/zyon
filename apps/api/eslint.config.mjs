// @ts-check
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Boundary + import-order rules
  {
    plugins: {
      boundaries,
      import: importPlugin,
    },

    settings: {
      // Each element type captures the bounded-context name from the path.
      // Pattern wildcards map positionally to the capture array.
      // Example: src/modules/checkout/domain/... → context = 'checkout'
      'boundaries/elements': [
        {
          type: 'domain',
          pattern: 'src/modules/*/domain/**',
          capture: ['context'],
          mode: 'file',
        },
        {
          type: 'application',
          pattern: 'src/modules/*/application/**',
          capture: ['context'],
          mode: 'file',
        },
        {
          type: 'infrastructure',
          pattern: 'src/modules/*/infrastructure/**',
          capture: ['context'],
          mode: 'file',
        },
        {
          type: 'presentation',
          pattern: 'src/modules/*/presentation/**',
          capture: ['context'],
          mode: 'file',
        },
        {
          // *.module.ts and top-level module files
          type: 'module-root',
          pattern: 'src/modules/*/*.ts',
          capture: ['context'],
          mode: 'file',
        },
      ],

      'boundaries/include': ['src/**'],

      // TypeScript-aware resolver so boundaries can follow .js imports → .ts files.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },

    rules: {
      // -------------------------------------------------------
      // Layer + cross-context boundary enforcement
      // default: 'disallow' → anything not explicitly allowed is an error.
      // '${from.context}' resolves to the captured context of the importing file,
      // ensuring each context can only touch its own layers.
      // -------------------------------------------------------
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // domain: only same-context domain imports allowed
            {
              from: [['domain', { context: '*' }]],
              allow: [['domain', { context: '${from.context}' }]],
            },

            // application: same-context domain + application
            {
              from: [['application', { context: '*' }]],
              allow: [
                ['domain', { context: '${from.context}' }],
                ['application', { context: '${from.context}' }],
              ],
            },

            // infrastructure: same-context domain + application + infrastructure
            {
              from: [['infrastructure', { context: '*' }]],
              allow: [
                ['domain', { context: '${from.context}' }],
                ['application', { context: '${from.context}' }],
                ['infrastructure', { context: '${from.context}' }],
              ],
            },

            // presentation: same-context domain + application + presentation
            {
              from: [['presentation', { context: '*' }]],
              allow: [
                ['domain', { context: '${from.context}' }],
                ['application', { context: '${from.context}' }],
                ['presentation', { context: '${from.context}' }],
              ],
            },

            // module-root (*.module.ts, context barrel): all layers of same context
            {
              from: [['module-root', { context: '*' }]],
              allow: [
                ['domain', { context: '${from.context}' }],
                ['application', { context: '${from.context}' }],
                ['infrastructure', { context: '${from.context}' }],
                ['presentation', { context: '${from.context}' }],
                ['module-root', { context: '${from.context}' }],
              ],
            },
          ],
        },
      ],

      // -------------------------------------------------------
      // Cross-context infrastructure imports (string-based, no resolver needed)
      // Catches the 12 known violations where modules import checkout's prisma client.
      // Remove after Wave 1 moves prisma-client to @app/persistence.
      // -------------------------------------------------------
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/checkout/infrastructure/**'],
              message:
                'Direct import from checkout/infrastructure is forbidden. ' +
                'Use @app/persistence after Wave 1 migration.',
            },
          ],
        },
      ],

      // -------------------------------------------------------
      // Import ordering: builtin → external → internal → relative
      // -------------------------------------------------------
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            { pattern: '@aacp/**', group: 'internal', position: 'before' },
            { pattern: '@app/**', group: 'internal', position: 'before' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
);
