import type { CommercialNotice } from "@zyon/shared-types";
import { canonicalCommercialNotice } from "@zyon/contracts";

/** The caller must supply a verified decision code; never infer it from copy. */
export function commercialNotice(code: CommercialNotice["code"]): CommercialNotice {
  return canonicalCommercialNotice(code);
}

