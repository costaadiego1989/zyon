import { Inject, Injectable } from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
} from "../domain/ports/commerce-connection.port.js";

@Injectable()
export class DisconnectCommerceUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  async execute(merchantId: string): Promise<void> {
    await this.connections.disconnect(merchantId);
  }
}
