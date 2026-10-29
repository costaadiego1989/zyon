import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import crypto from "node:crypto";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "Checkout Protocol Integration: ProtocolSession with state history and expiry",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantId = `mrc_proto_${crypto.randomUUID()}`;
    const agentId = `agent_${crypto.randomUUID()}`;
    let sessionId: string;
    let tokenHash: string;

    try {
      // ─── Test 1: Create ProtocolSession → find by id → returns with stateHistory ───
      await test("Create ProtocolSession, find by ID with stateHistory", async () => {
        sessionId = `proto_${crypto.randomUUID()}`;
        tokenHash = crypto.createHash("sha256").update(`token_${crypto.randomUUID()}`).digest("hex");

        const created = await prisma.protocolSession.create({
          data: {
            id: sessionId,
            merchantId,
            agentId,
            currentState: "idle",
            stateHistory: [{ state: "idle", timestamp: new Date().toISOString() }],
            sessionData: { cartItems: [] },
            tokenHash,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
          },
        });

        assert.equal(created.id, sessionId, "session ID matches");
        assert.equal(created.merchantId, merchantId, "merchant ID stored");
        assert.equal(created.currentState, "idle", "initial state is idle");
        assert.ok(created.stateHistory, "stateHistory exists");
        assert.ok(created.createdAt, "createdAt timestamp set");

        const found = await prisma.protocolSession.findUnique({
          where: { id: sessionId },
        });

        assert.ok(found, "session found by ID");
        assert.equal(found!.currentState, "idle", "state retrieved correctly");
      });

      // ─── Test 2: Update currentState → stateHistory appends (not overwrites) ───
      await test("Update currentState, verify stateHistory appends", async () => {
        const before = await prisma.protocolSession.findUnique({
          where: { id: sessionId },
        });

        const beforeHistory = before!.stateHistory as any[];
        assert.equal(beforeHistory.length, 1, "initial history has 1 entry");

        const newEntry = { state: "discovered", timestamp: new Date().toISOString() };
        const updatedHistory = [...beforeHistory, newEntry];

        await prisma.protocolSession.update({
          where: { id: sessionId },
          data: {
            currentState: "discovered",
            stateHistory: updatedHistory,
          },
        });

        const after = await prisma.protocolSession.findUnique({
          where: { id: sessionId },
        });

        const afterHistory = after!.stateHistory as any[];
        assert.equal(afterHistory.length, 2, "history now has 2 entries");
        assert.equal(afterHistory[0].state, "idle", "first entry preserved");
        assert.equal(afterHistory[1].state, "discovered", "new entry appended");
      });

      // ─── Test 3: Session expiry: session expired 1 min ago → reaper query finds it ───
      await test("Session expiry: find expired sessions via reaper query", async () => {
        const expiredSessionId = `proto_${crypto.randomUUID()}`;
        const expiredAt = new Date(Date.now() - 60 * 1000); // 1 minute ago

        await prisma.protocolSession.create({
          data: {
            id: expiredSessionId,
            merchantId,
            agentId,
            currentState: "idle",
            stateHistory: [{ state: "idle", timestamp: new Date().toISOString() }],
            sessionData: {},
            tokenHash: crypto.createHash("sha256").update(`expired_${crypto.randomUUID()}`).digest("hex"),
            expiresAt: expiredAt,
          },
        });

        // Reaper query: find all sessions that expired before now and are not already marked expired
        const expiredSessions = await prisma.protocolSession.findMany({
          where: {
            expiresAt: { lte: new Date() },
            currentState: { not: "expired" },
          },
          select: { id: true },
        });

        assert.ok(
          expiredSessions.some((s) => s.id === expiredSessionId),
          "expired session found by reaper"
        );

        // Cleanup: mark as expired
        await prisma.protocolSession.update({
          where: { id: expiredSessionId },
          data: { currentState: "expired" },
        });

        const requeriedSessions = await prisma.protocolSession.findMany({
          where: {
            expiresAt: { lte: new Date() },
            currentState: { not: "expired" },
          },
          select: { id: true },
        });

        assert.ok(
          !requeriedSessions.some((s) => s.id === expiredSessionId),
          "expired session excluded from reaper query after marking"
        );
      });

      // ─── Test 4: Token hash lookup: find session by tokenHash → returns correct session ───
      await test("Find ProtocolSession by tokenHash", async () => {
        const session = await prisma.protocolSession.findFirst({
          where: { tokenHash },
        });

        assert.ok(session, "session found by tokenHash");
        assert.equal(session.id, sessionId, "correct session returned");
        assert.equal(session.merchantId, merchantId, "merchant ID matches");
      });

      // ─── Test 5: Multiple sessions for same merchant+agent → list returns all ordered by createdAt ───
      await test("List multiple sessions for merchant+agent, ordered by createdAt", async () => {
        const session2Id = `proto_${crypto.randomUUID()}`;
        const session3Id = `proto_${crypto.randomUUID()}`;

        // Small delay to ensure createdAt ordering
        await new Promise((r) => setTimeout(r, 10));

        await prisma.protocolSession.create({
          data: {
            id: session2Id,
            merchantId,
            agentId,
            currentState: "idle",
            stateHistory: [{ state: "idle", timestamp: new Date().toISOString() }],
            sessionData: {},
            tokenHash: crypto.createHash("sha256").update(`token_${crypto.randomUUID()}`).digest("hex"),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        await new Promise((r) => setTimeout(r, 10));

        await prisma.protocolSession.create({
          data: {
            id: session3Id,
            merchantId,
            agentId,
            currentState: "idle",
            stateHistory: [{ state: "idle", timestamp: new Date().toISOString() }],
            sessionData: {},
            tokenHash: crypto.createHash("sha256").update(`token_${crypto.randomUUID()}`).digest("hex"),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        const sessions = await prisma.protocolSession.findMany({
          where: { merchantId, agentId },
          orderBy: { createdAt: "asc" },
        });

        assert.ok(sessions.length >= 3, "at least 3 sessions found");
        assert.equal(
          sessions[sessions.length - 1].id,
          session3Id,
          "most recent session is last"
        );
      });

      // ─── Test 6: Concurrent state update (last-write-wins) → verify behavior ───
      await test("Concurrent state update: last-write-wins semantics", async () => {
        const concurrentSessionId = `proto_${crypto.randomUUID()}`;

        await prisma.protocolSession.create({
          data: {
            id: concurrentSessionId,
            merchantId,
            agentId,
            currentState: "idle",
            stateHistory: [{ state: "idle", timestamp: new Date().toISOString() }],
            sessionData: {},
            tokenHash: crypto.createHash("sha256").update(`concurrent_${crypto.randomUUID()}`).digest("hex"),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        // Simulate two concurrent updates (in this test, sequential but verifies outcome)
        const stateA = "discovered";
        const stateB = "negotiated";

        // First update
        await prisma.protocolSession.update({
          where: { id: concurrentSessionId },
          data: {
            currentState: stateA,
            stateHistory: [
              { state: "idle", timestamp: new Date().toISOString() },
              { state: stateA, timestamp: new Date().toISOString() },
            ],
          },
        });

        // Second update (overwrites first)
        await prisma.protocolSession.update({
          where: { id: concurrentSessionId },
          data: {
            currentState: stateB,
            stateHistory: [
              { state: "idle", timestamp: new Date().toISOString() },
              { state: stateB, timestamp: new Date().toISOString() },
            ],
          },
        });

        const final = await prisma.protocolSession.findUnique({
          where: { id: concurrentSessionId },
        });

        assert.equal(final!.currentState, stateB, "final state is last-written state");

        // Cleanup
        await prisma.protocolSession.delete({
          where: { id: concurrentSessionId },
        });
      });
    } finally {
      await prisma.protocolSession.deleteMany({
        where: { merchantId },
      });
      await prisma.$disconnect();
    }
  }
);
