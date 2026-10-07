import { CreatePaymentIntentUseCase } from "../application/create-payment-intent.use-case.js";

/** Legacy external-adapter fixtures have no native catalog rows. The real
 * production service still requires its injected database stock authority. */
export class StockCheckedCreatePaymentIntentUseCase extends CreatePaymentIntentUseCase {
  constructor(...args: ConstructorParameters<typeof CreatePaymentIntentUseCase>) {
    args[14] ??= { productVariant: { findMany: async () => [] } } as never;
    super(...args);
  }
}
