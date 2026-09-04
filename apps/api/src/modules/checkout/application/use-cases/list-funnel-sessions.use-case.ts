import { Injectable , Logger} from "@nestjs/common";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface FunnelSessionRow {
  sessionId: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerName: string;
  stage: "data_collection" | "shipping" | "payment" | "completed";
  lastActivityAt: string;
  abandonmentScore: number;
}

export interface ListFunnelSessionsResponse {
  sessions: FunnelSessionRow[];
  total: number;
  status: "active" | "all";
}

@Injectable()
export class ListFunnelSessionsUseCase {
  private readonly logger = new Logger(ListFunnelSessionsUseCase.name);

  async execute(
    merchantId: string,
    options: { status?: "active" | "all"; limit?: number } = {}
  ): Promise<ListFunnelSessionsResponse> {
    const { status = "active", limit = 50 } = options;

    return {
      sessions: [],
      total: 0,
      status,
    };
  }
}
