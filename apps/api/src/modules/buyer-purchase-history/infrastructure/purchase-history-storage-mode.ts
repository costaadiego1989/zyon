import { usesPrismaPersistence } from "../../../shared/persistence/uses-prisma-persistence.js";

export function usesPrismaPurchaseHistory(): boolean {
  return usesPrismaPersistence();
}
