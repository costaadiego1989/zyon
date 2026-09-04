import { Inject, Injectable , Logger} from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type MerchantCommerceConnection,
} from "../domain/ports/commerce-connection.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetCommerceConnectionUseCase {
  private readonly logger = new Logger(GetCommerceConnectionUseCase.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  execute(merchantId: string): Promise<MerchantCommerceConnection | undefined> {
    return this.connections.getConnection(merchantId);
  }
}
