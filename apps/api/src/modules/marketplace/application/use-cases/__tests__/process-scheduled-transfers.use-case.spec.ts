import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessScheduledTransfersUseCase } from "../process-scheduled-transfers.use-case.js";
import { SettlementStateMachineService } from "../../../domain/services/settlement-state-machine.service.js";

const nowDate = new Date("2026-09-05T12:00:00Z");
const scheduledAt = new Date("2026-09-02T12:00:00Z");
function setup(expired: any[] = [], due: any[] = [], config: any = { returnWindowDays: 7, payoutDelayDays: 4, chargebackWindowDays: 14 }) {
  const writes: any[] = [];
  const configReads: string[] = [];
  const repository = {
    findExpiredReturnWindows: async () => expired,
    findDueTransfers: async () => due,
    updateStatus: async (input: any) => { writes.push(input); return input; },
  };
  const useCase = new ProcessScheduledTransfersUseCase(repository as any, new SettlementStateMachineService(), {
    get: async (merchantId: string) => { configReads.push(merchantId); return config; },
  } as any);
  return { useCase, writes, configReads, repository };
}
const expired = { id: "s", hostMerchantId: "host", status: "awaiting_return_window", returnWindowUntil: new Date("2026-08-29T12:00:00Z"), transferScheduledAt: scheduledAt };

describe("Marketplace payout holds until a provider is available", () => {
  it("never records a transfer just because it is due, including replay and legacy transfer IDs", async () => {
    const { useCase, writes } = setup([], [{ id: "s1", status: "transfer_scheduled" }, { id: "s2", providerTransferId: "legacy-unverified" }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await useCase.execute({ nowDate });
      assert.equal(result.transfersExecuted, 0);
      assert.equal(result.transfersBlocked, 2);
      assert.equal(result.processed, 0);
    }
    assert.equal(writes.length, 0);
  });
  it("preserves the payout date snapshotted at order creation and uses a conditional transition", async () => {
    const { useCase, writes, configReads } = setup([expired]);
    const result = await useCase.execute({ nowDate });
    assert.equal(result.returnWindowsExpired, 1);
    assert.equal(writes[0].transferScheduledAt.toISOString(), scheduledAt.toISOString());
    assert.equal(writes[0].expectedStatus, "awaiting_return_window");
    assert.equal(writes[0].status, "transfer_scheduled");
    assert.equal(configReads.length, 0);
  });
  it("uses the host's configured delay for legacy records instead of now plus one day", async () => {
    const { useCase, writes, configReads } = setup([{ ...expired, transferScheduledAt: null }]);
    await useCase.execute({ nowDate });
    assert.deepEqual(configReads, ["host"]);
    assert.equal(writes[0].transferScheduledAt.toISOString(), scheduledAt.toISOString());
  });
  it("does not invent a schedule when legacy configuration is missing or invalid", async () => {
    for (const config of [null, { returnWindowDays: 7, payoutDelayDays: -1, chargebackWindowDays: 14 }]) {
      const { useCase, writes } = setup([{ ...expired, transferScheduledAt: null }], [], config);
      const result = await useCase.execute({ nowDate });
      assert.equal(result.schedulesBlocked, 1);
      assert.equal(writes.length, 0);
    }
  });
  it("does not count a failed conditional update as a completed schedule", async () => {
    const { useCase, repository } = setup([expired]);
    repository.updateStatus = async () => { throw new Error("state already changed"); };
    const result = await useCase.execute({ nowDate });
    assert.equal(result.returnWindowsExpired, 0);
    assert.equal(result.schedulesBlocked, 1);
  });
});
