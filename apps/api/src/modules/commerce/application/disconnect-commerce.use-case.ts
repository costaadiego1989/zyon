import { Inject, Injectable , Logger} from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
} from "../domain/ports/commerce-connection.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class DisconnectCommerceUseCase {
  private readonly logger = new Logger(DisconnectCommerceUseCase.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  async execute(merchantId: string): Promise<void> {
    await this.connections.disconnect(merchantId);
  }
}
