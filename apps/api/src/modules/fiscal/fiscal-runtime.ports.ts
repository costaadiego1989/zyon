import type { Prisma } from "@prisma/client";
import type { FiscalOrderCommitPort } from "./domain/fiscal-order-commit.port.js";
import type { FiscalDocumentService } from "./application/fiscal-document.service.js";
import type { FiscalEnvironment } from "./domain/fiscal-provider.js";
export const FISCAL_ORDER_COMMIT_FACTORY = Symbol(
  "FISCAL_ORDER_COMMIT_FACTORY"
);
export type FiscalOrderCommitFactory = (
  transaction: Prisma.TransactionClient
) => FiscalOrderCommitPort;
export const FISCAL_ASSISTANT = Symbol("FISCAL_ASSISTANT");
export interface FiscalAssistant {
  documents: FiscalDocumentService;
  environment: FiscalEnvironment;
}
