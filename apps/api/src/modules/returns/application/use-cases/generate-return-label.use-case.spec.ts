import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerateReturnLabelUseCase } from "./generate-return-label.use-case.js";

test("return labels cannot fabricate tracking or a stub PDF", async () => {
  let writes = 0;
  const useCase = new GenerateReturnLabelUseCase({ findById: async () => ({ canGenerateLabel: true, status: "REQUESTED" }),
    saveLabel: async () => { writes++; }, updateStatus: async () => { writes++; } } as any);
  await assert.rejects(useCase.execute("host", "return"), /return_shipping_label_required/);
  await assert.rejects(useCase.execute("host", "return", { carrier: "Correios", trackingNumber: "AB123456789BR", labelUrl: "https://labels.stub.zyon.dev/return.pdf" }), /return_shipping_label_url_invalid/);
  assert.equal(writes, 0);
});
test("a carrier-issued reverse posting code can be registered without a financial charge", async () => {
  const labels: any[] = [], statuses: any[] = [];
  const useCase = new GenerateReturnLabelUseCase({ findById: async () => ({ canGenerateLabel: true, status: "REQUESTED" }),
    saveLabel: async (input: any) => labels.push(input), updateStatus: async (...input: any[]) => statuses.push(input) } as any);
  await useCase.execute("host", "return", { carrier: "Correios", trackingNumber: "1234567890" });
  assert.equal(labels[0].trackingNumber, "1234567890"); assert.equal(labels[0].labelUrl, undefined);
  assert.deepEqual(statuses, [["return", "LABEL_GENERATED", "REQUESTED"]]);
});
