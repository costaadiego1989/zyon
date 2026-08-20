import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { StateHistoryEntry } from "../domain/agent-checkout-state.service.js";

export interface ProtocolSession {
  id: string;
  merchantId: string;
  agentId: string;
  currentState: string;
  stateHistory: StateHistoryEntry[];
  sessionData: Record<string, unknown>;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const PROTOCOL_SESSION_REPOSITORY = Symbol("PROTOCOL_SESSION_REPOSITORY");

export interface ProtocolSessionRepository {
  create(data: {
    id: string;
    merchantId: string;
    agentId: string;
    currentState: string;
    stateHistory: StateHistoryEntry[];
    sessionData: Record<string, unknown>;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<ProtocolSession>;

  findById(sessionId: string): Promise<ProtocolSession | null>;
  findByIdAndMerchant(sessionId: string, merchantId: string): Promise<ProtocolSession | null>;

  updateState(
    sessionId: string,
    newState: string,
    stateHistory: StateHistoryEntry[],
    sessionData: Record<string, unknown>,
    expiresAt: Date
  ): Promise<ProtocolSession>;

  markExpired(sessionId: string): Promise<void>;
  listExpired(before: Date): Promise<string[]>;
}

@Injectable()
export class PrismaProtocolSessionRepository implements ProtocolSessionRepository {
  private readonly logger = new Logger(PrismaProtocolSessionRepository.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(data: {
    id: string;
    merchantId: string;
    agentId: string;
    currentState: string;
    stateHistory: StateHistoryEntry[];
    sessionData: Record<string, unknown>;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<ProtocolSession> {
    const row = await this.prisma.protocolSession.create({
      data: {
        id: data.id,
        merchantId: data.merchantId,
        agentId: data.agentId,
        currentState: data.currentState,
        stateHistory: JSON.parse(JSON.stringify(data.stateHistory)),
        sessionData: JSON.parse(JSON.stringify(data.sessionData)),
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });

    return this.toDomain(row);
  }

  async findById(sessionId: string): Promise<ProtocolSession | null> {
    const row = await this.prisma.protocolSession.findUnique({
      where: { id: sessionId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByIdAndMerchant(sessionId: string, merchantId: string): Promise<ProtocolSession | null> {
    const row = await this.prisma.protocolSession.findFirst({
      where: {
        id: sessionId,
        merchantId,
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async updateState(
    sessionId: string,
    newState: string,
    stateHistory: StateHistoryEntry[],
    sessionData: Record<string, unknown>,
    expiresAt: Date
  ): Promise<ProtocolSession> {
    const row = await this.prisma.protocolSession.update({
      where: { id: sessionId },
      data: {
        currentState: newState,
        stateHistory: JSON.parse(JSON.stringify(stateHistory)),
        sessionData: JSON.parse(JSON.stringify(sessionData)),
        expiresAt,
        updatedAt: new Date(),
      },
    });
    return this.toDomain(row);
  }

  async markExpired(sessionId: string): Promise<void> {
    await this.prisma.protocolSession.update({
      where: { id: sessionId },
      data: {
        currentState: "expired",
      },
    });
  }

  async listExpired(before: Date): Promise<string[]> {
    const rows = await this.prisma.protocolSession.findMany({
      where: {
        expiresAt: { lte: before },
        currentState: { not: "expired" },
      },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }

  private toDomain(row: any): ProtocolSession {
    return {
      id: row.id,
      merchantId: row.merchantId,
      agentId: row.agentId,
      currentState: row.currentState,
      stateHistory: (row.stateHistory ?? []) as StateHistoryEntry[],
      sessionData: (row.sessionData ?? {}) as Record<string, unknown>,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
