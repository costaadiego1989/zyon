import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";

export type ReadinessResult =
  | { ready: true; db: "connected" }
  | { ready: false; db: "disconnected" };

@Injectable()
export class HealthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  liveness(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<ReadinessResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ready: true, db: "connected" };
    } catch {
      return { ready: false, db: "disconnected" };
    }
  }
}