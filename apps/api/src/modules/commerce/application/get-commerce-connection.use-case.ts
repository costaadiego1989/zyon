import { Inject, Injectable } from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type MerchantCommerceConnection,
} from "../domain/ports/commerce-connection.port.js";

@Injectable()
export class GetCommerceConnectionUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  execute(merchantId: string): Promise<MerchantCommerceConnection | undefined> {
    return this.connections.getConnection(merchantId);
  }
}
