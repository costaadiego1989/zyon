import { createHash } from "node:crypto";

// The challenge is public DNS data. Binding it to the immutable registration ID
// invalidates a previous owner's TXT record after deletion and re-registration.
export function domainOwnershipChallenge(record: { id: string; merchantId: string; domain: string }) {
  return {
    txt_name: "_zyon-verification." + record.domain,
    txt_value: "zyon-verification=" + createHash("sha256").update(JSON.stringify([record.id, record.merchantId, record.domain])).digest("hex"),
  };
}
