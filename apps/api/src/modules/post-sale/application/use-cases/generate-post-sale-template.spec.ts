import test from "node:test";
import assert from "node:assert/strict";
import { GeneratePostSaleTemplateUseCase } from "./generate-post-sale-template.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../../whatsapp-templates/domain/catalog/template-types.js";
import { prepareSalesWhatsApp, salesDefaults } from "../../../whatsapp-templates/domain/sales-template-content.js";
for (const type of WHATSAPP_TEMPLATE_TYPES) test(`invalid AI suggestion falls back to the correct native ${type} template`, async () => {
  const service = new GeneratePostSaleTemplateUseCase({ generateWithAi: async () => "Texto com {{unsupported}}" } as any);
  const generated = await service.execute({ type, channel: "whatsapp", storeName: "Loja" });
  assert.equal(generated.body, salesDefaults(type).whatsapp.body);
  assert.equal(generated.meta.metaBody, prepareSalesWhatsApp(type, generated.body).metaBody);
});
