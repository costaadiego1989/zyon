import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
export const TRACING_RUNTIME = Symbol("TracingRuntime");
@Injectable()
export class TracingLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TRACING_RUNTIME) private readonly runtime: { shutdown(): Promise<void> }) {}
  async onApplicationShutdown(): Promise<void> { await this.runtime.shutdown(); }
}

