import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";

export function withCheckoutTransaction<T>(
  repository: CheckoutRepository,
  work: (repository: CheckoutRepository) => Promise<T>
): Promise<T> {
  return repository.transaction ? repository.transaction(work) : work(repository);
}
