// @ts-check
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const testFiles = [
  'src/**/*.spec.ts',
  'src/**/*-spec.ts',
  'src/**/__test__/**',
  'src/**/__tests__/**',
];

const transitionalInfrastructureConsumers = [
  'src/modules/checkout/application/services/checkout-customer.service.ts',
  'src/modules/payment/application/create-payment-intent.use-case.ts',
  'src/modules/payment/application/handle-stripe-webhook.use-case.ts',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  {
    files: ['src/modules/*/{domain,application,infrastructure,presentation}/**/*.ts'],
    ignores: testFiles,

    languageOptions: {
      parser: tseslint.parser,
    },

    plugins: {
      boundaries,
    },

    settings: {
      'boundaries/elements': [
        {
          type: 'domain',
          pattern: 'src/modules/*/domain/**',
          capture: ['context', 'internal'],
          mode: 'file',
        },
        {
          type: 'application',
          pattern: 'src/modules/*/application/**',
          capture: ['context', 'internal'],
          mode: 'file',
        },
        {
          type: 'infrastructure',
          pattern: 'src/modules/*/infrastructure/**',
          capture: ['context', 'internal'],
          mode: 'file',
        },
        {
          type: 'presentation',
          pattern: 'src/modules/*/presentation/**',
          capture: ['context', 'internal'],
          mode: 'file',
        },
        {
          type: 'module-root',
          pattern: 'src/modules/*/*.module.ts',
          capture: ['context'],
          mode: 'file',
        },
      ],

      'boundaries/include': ['src/modules/**'],

      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },

    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: 'domain',
              allow: ['domain'],
            },
            {
              from: 'application',
              allow: ['domain', 'application'],
            },
            {
              from: [['infrastructure', { context: '*' }]],
              allow: [
                'domain',
                'application',
                ['infrastructure', { context: '${from.context}' }],
              ],
            },
            {
              from: 'presentation',
              allow: ['domain', 'application', 'presentation'],
            },
            {
              from: [
                [
                  'domain',
                  {
                    context: 'auth',
                    internal: 'services/auth-cookie.service.ts',
                  },
                ],
              ],
              allow: [
                [
                  'application',
                  {
                    context: 'auth',
                    internal: 'register-merchant.use-case.ts',
                  },
                ],
              ],
            },
            {
              from: [
                [
                  'application',
                  {
                    context: 'checkout',
                    internal: 'services/checkout-customer.service.ts',
                  },
                ],
              ],
              allow: [
                [
                  'infrastructure',
                  {
                    context: 'checkout',
                    internal: 'brevo-buyer-email.notifier.ts',
                  },
                ],
              ],
            },
            {
              from: [
                [
                  'application',
                  {
                    context: 'payment',
                    internal: 'create-payment-intent.use-case.ts',
                  },
                ],
              ],
              allow: [
                ['infrastructure', { context: 'payment', internal: 'asaas-env.ts' }],
                ['infrastructure', { context: 'payment', internal: 'stripe-env.ts' }],
              ],
            },
            {
              from: [
                [
                  'application',
                  {
                    context: 'payment',
                    internal: 'handle-stripe-webhook.use-case.ts',
                  },
                ],
              ],
              allow: [
                ['infrastructure', { context: 'payment', internal: 'stripe-env.ts' }],
              ],
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      'src/modules/*/domain/**/*.ts',
      'src/modules/*/application/**/*.ts',
      'src/modules/*/presentation/**/*.ts',
    ],
    ignores: testFiles,

    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**'],
              message:
                'Layer code must depend on domain/application ports, not infrastructure implementations.',
            },
          ],
        },
      ],
    },
  },

  {
    files: transitionalInfrastructureConsumers,
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
