import React from "react";
import type { MerchantProfile } from "../api/types.js";
import type { TabKey } from "../shell/nav-config.js";
import { canAccessTab } from "../lib/auth/permissions.js";
import { useAccessModal } from "../lib/auth/access-modal-context.js";

interface RouteGuardProps {
  me: MerchantProfile;
  require: TabKey;
  children: React.ReactNode;
}

export function RouteGuard({ me, require, children }: RouteGuardProps) {
  const allowed = canAccessTab(me.role, require);
  const { trigger } = useAccessModal();

  React.useEffect(() => {
    if (!allowed) trigger(require);
  }, [allowed, require, trigger]);

  if (!allowed) return null;
  return <>{children}</>;
}
