import { SetMetadata } from "@nestjs/common";

export const STAFF_READABLE_METADATA = "aacp:staff_readable";

export const StaffReadable = (): MethodDecorator & ClassDecorator =>
  SetMetadata(STAFF_READABLE_METADATA, true);
