import { SetMetadata } from "@nestjs/common";
import type { PlatformPermission } from "../domain/platform-operator.js";

export const PLATFORM_PERMISSIONS_METADATA = "platform_permissions";

export function RequirePlatformPermissions(...permissions: PlatformPermission[]) {
  return SetMetadata(PLATFORM_PERMISSIONS_METADATA, permissions);
}
