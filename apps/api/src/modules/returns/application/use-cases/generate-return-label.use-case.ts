import { Injectable, Inject, Optional, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { ReturnReverseShippingService } from "../return-reverse-shipping.service.js";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GenerateReturnLabelUseCase {
  private readonly logger = new Logger(GenerateReturnLabelUseCase.name);

  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Optional() @Inject(ReturnReverseShippingService) private readonly reverseShipping?: ReturnReverseShippingService) {}

  async execute(merchantId: string, returnId: string, input?: { carrier: string; trackingNumber: string; labelUrl?: string }): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canGenerateLabel) {
      throw new BadRequestException("invalid_status_for_label_generation");
    }
    await this.reverseShipping?.assertManualAllowed(merchantId, returnId);

    // Reverse logistics is a separate carrier purchase. Register a real label
    // or posting code; never invent a tracking number or a PDF receipt.
    const carrier = input?.carrier?.trim(), trackingNumber = input?.trackingNumber?.trim();
    if (!carrier || !/^[A-Za-z0-9À-ÿ ._-]{2,80}$/.test(carrier) || !trackingNumber ||
        !/^[A-Za-z0-9_-]{4,100}$/.test(trackingNumber)) throw new BadRequestException("return_shipping_label_required");
    let labelUrl: string | undefined;
    if (input?.labelUrl?.trim()) {
      try {
        const url = new URL(input.labelUrl.trim());
        if (url.protocol !== "https:" || url.username || url.password || url.hostname === "labels.stub.zyon.dev" || input.labelUrl.length > 2048) throw Error();
        labelUrl = url.href;
      } catch { throw new BadRequestException("return_shipping_label_url_invalid"); }
    }
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    const label = {
      returnId,
      carrier,
      trackingNumber,
      labelUrl,
      expiresAt,
    };

    if (this.returnRepo.registerManualLabel) await this.returnRepo.registerManualLabel(merchantId, label);
    else {
      await this.returnRepo.saveLabel(label);
      await this.returnRepo.updateStatus(returnId, "LABEL_GENERATED", ret.status);
    }

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
