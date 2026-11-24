import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { ImmutableServiceReleaseArtifact } from "../../../shared/bookings/service-release-artifact.js";
import { serviceActivationReadinessWithin } from "../../../shared/bookings/service-activation-readiness.js";

/** Internal read service: controller retains the existing owner/admin/tenant
 * boundary. No endpoint accepts release evidence or changes admission here. */
@Injectable()
export class ServiceActivationReadinessService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly artifact: ImmutableServiceReleaseArtifact) {}
  read(merchantId: string) {
    return this.prisma.$transaction(tx => serviceActivationReadinessWithin(tx, merchantId, undefined, this.artifact), { isolationLevel: "RepeatableRead" });
  }
}
