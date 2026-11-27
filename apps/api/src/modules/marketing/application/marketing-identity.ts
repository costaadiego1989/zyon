import { createHash } from "node:crypto";
import { marketingPhone } from "../domain/marketing.js";
/** Minimum tenant-bound pseudonymous keys retained only to honor a negative choice. */
export function marketingSuppressionHashes(
  merchantId: string,
  phone: string | null,
  accountId: string | null
) {
  return [
    ...(phone ? [["phone", marketingPhone(phone)]] : []),
    ...(accountId ? [["account", accountId]] : []),
  ].map((identity) =>
    createHash("sha256")
      .update(JSON.stringify([merchantId, ...identity]))
      .digest("hex")
  );
}
