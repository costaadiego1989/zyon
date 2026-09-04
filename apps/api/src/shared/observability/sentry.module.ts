import {
  DynamicModule,
  Global,
  Logger,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { resolveSentryConfig, type SentryConfig } from "./sentry.config.js";
import { SentryExceptionFilter } from "./sentry-exception.filter.js";

const SENTRY_CONFIG = Symbol("SentryConfig");
const SENTRY_SDK = Symbol("SentrySdk");
const SENTRY_ENABLED = Symbol("SentryEnabled");

interface SentryLike {
  withScope(cb: (scope: { setTag(key: string, value: string): void }) => void): void;
  captureException(err: unknown): void;
}

interface SentryModuleOptions {
  /**
   * Override the env used to compute the config. Defaults to `process.env`.
   * Primarily useful for tests.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Test-only injection point for a fake Sentry SDK. Production callers
   * omit this; the real SDK is used instead.
   */
  sdkOverride?: SentryLike;
}

interface SentryModuleProviders {
  config: SentryConfig;
  sdk: SentryLike | null;
  enabled: boolean;
}

const state: SentryModuleProviders = {
  config: {
    enabled: false,
    dsn: undefined,
    environment: "development",
    release: undefined,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  },
  sdk: null,
  enabled: false,
};

@Global()
@Module({})
export class SentryModule implements OnApplicationShutdown {
  /**
   * Configure Sentry. Returns a DynamicModule that wires the exception filter
   * globally and exposes accessors the rest of the app uses to capture events.
   *
   * Safe to call when `SENTRY_DSN` is missing — the module still loads but
   * `isSentryEnabled()` returns false and capture calls become safe no-ops.
   */
  static forRoot(options: SentryModuleOptions = {}): DynamicModule {
    const env = options.env ?? process.env;
    const config = resolveSentryConfig(env);
    state.config = config;

    if (config.enabled && config.dsn) {
      const realSdk = initSdk(config);
      state.sdk = (options.sdkOverride as unknown as typeof Sentry) ?? realSdk;
      state.enabled = realSdk !== null;
    } else {
      state.sdk = options.sdkOverride ?? null;
      state.enabled = options.sdkOverride !== undefined;
    }

    return {
      module: SentryModule,
      providers: [
        { provide: SENTRY_CONFIG, useValue: state.config },
        { provide: SENTRY_SDK, useValue: state.sdk },
        { provide: SENTRY_ENABLED, useValue: state.enabled },
        { provide: APP_FILTER, useClass: SentryExceptionFilter },
      ],
      exports: [SENTRY_CONFIG, SENTRY_ENABLED],
    };
  }

  onApplicationShutdown(): void {
    if (state.enabled && state.sdk) {
      try {
        const close = (state.sdk as unknown as { close?: (timeout: number) => void }).close;
        close?.(2_000);
      } catch (err) {
        Logger.warn(
          `Sentry shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
          SentryModule.name,
        );
      }
    }
  }
}

function initSdk(config: SentryConfig): typeof Sentry | null {
  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      profilesSampleRate: config.profilesSampleRate,
      integrations: [nodeProfilingIntegration()],
      enabled: true,
    });
    return Sentry;
  } catch (err) {
    Logger.warn(
      `Sentry init failed; running without error tracking. ${
        err instanceof Error ? err.message : String(err)
      }`,
      SentryModule.name,
    );
    return null;
  }
}

export function isSentryEnabled(): boolean {
  return state.enabled;
}

/**
 * Returns the Sentry SDK. When Sentry is disabled this returns the real SDK
 * still — but `init` was never called, so `captureException` etc. are safe
 * no-ops at the SDK level.
 */
export function getSentry(): SentryLike {
  return state.sdk as unknown as SentryLike;
}

export function getSentryConfig(): SentryConfig {
  return state.config;
}

/**
 * Test-only: override the captured SDK without going through `forRoot`. Lets
 * specs stub Sentry without re-importing the module or hitting ESM read-only
 * bindings.
 */
export function __setSentrySdkForTesting(sdk: SentryLike | null, enabled: boolean): void {
  state.sdk = sdk;
  state.enabled = enabled;
}

export const SENTRY_CONFIG_TOKEN = SENTRY_CONFIG;
export const SENTRY_ENABLED_TOKEN = SENTRY_ENABLED;