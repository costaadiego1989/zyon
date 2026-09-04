import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import { requireSecret } from "../../../shared/config/secret-config.js";
import {
  OPERATIONS_READ_REPOSITORY,
  type OperationsCursor,
  type OperationsReadRepository,
} from "../domain/ports/operations-read.repository.port.js";

@Injectable()
export class ListOrdersUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  execute(input: PageInput) {
    return page(
      input,
      (request) => this.repository.listOrders(request),
      (row) => ({ occurredAt: row.completedAt, id: row.id }),
    );
  }
}

@Injectable()
export class GetOrderUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  async execute(merchantId: string, orderId: string) {
    const order = await this.repository.getOrder(
      required(merchantId, "merchant_id"),
      required(orderId, "order_id"),
    );
    if (!order) throw new NotFoundException("order_not_found");
    return order;
  }
}

@Injectable()
export class ListCustomersUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  execute(input: PageInput) {
    return page(
      input,
      (request) => this.repository.listCustomers(request),
      (row) => ({ occurredAt: row.lastSeenAt, id: row.id }),
    );
  }
}

@Injectable()
export class GetCustomerUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  async execute(merchantId: string, customerId: string) {
    const customer = await this.repository.getCustomer(
      required(merchantId, "merchant_id"),
      required(customerId, "customer_id"),
    );
    if (!customer) throw new NotFoundException("customer_not_found");
    return customer;
  }
}

@Injectable()
export class ListPaymentsUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  execute(input: PageInput) {
    return page(
      input,
      (request) => this.repository.listPayments(request),
      (row) => ({ occurredAt: row.updatedAt, id: row.id }),
    );
  }
}

@Injectable()
export class GetPaymentUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly repository: OperationsReadRepository,
  ) {}

  async execute(merchantId: string, paymentId: string) {
    const payment = await this.repository.getPayment(
      required(merchantId, "merchant_id"),
      required(paymentId, "payment_id"),
    );
    if (!payment) throw new NotFoundException("payment_not_found");
    return payment;
  }
}

interface PageInput {
  merchantId: string;
  limit?: number;
  cursor?: string;
}

async function page<T>(
  input: PageInput,
  read: (input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }) => Promise<T[]>,
  cursorFrom: (row: T) => OperationsCursor,
): Promise<{ data: T[]; nextCursor: string | null }> {
  const limit = clampLimit(input.limit);
  const rows = await read({
    merchantId: required(input.merchantId, "merchant_id"),
    limit: limit + 1,
    cursor: decodeCursor(input.cursor),
  });
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(cursorFrom(last))
        : null,
  };
}

function clampLimit(limit?: number): number {
  if (!Number.isInteger(limit)) return 25;
  return Math.max(1, Math.min(limit!, 100));
}

// H1 fix: HMAC-signed cursors prevent tampering
const cursorSecret = requireSecret(
  "OPERATIONS_CURSOR_SECRET",
  "dev-cursor-secret-change-me",
);

function encodeCursor(cursor: OperationsCursor): string {
  const json = JSON.stringify(cursor);
  const hmac = createHmac("sha256", cursorSecret)
    .update(json)
    .digest("hex");
  // Use "~" delimiter because JSON payloads (e.g. ISO timestamps with ".")
  // may contain "." which would break a naive split.
  return Buffer.from(`${json}~${hmac}`, "utf8").toString("base64url");
}

function decodeCursor(value?: string): OperationsCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const sepIndex = decoded.lastIndexOf("~");
    if (sepIndex <= 0) throw new Error("cursor_malformed");
    const json = decoded.slice(0, sepIndex);
    const hmac = decoded.slice(sepIndex + 1);
    if (!json || !hmac) throw new Error("cursor_malformed");

    const expected = createHmac("sha256", cursorSecret)
      .update(json)
      .digest("hex");
    if (hmac !== expected) throw new Error("cursor_tampered");

    const parsed = JSON.parse(json) as Partial<OperationsCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      Number.isNaN(new Date(parsed.occurredAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid_cursor");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new BadRequestException("cursor_invalid");
  }
}

function required(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${code}_required`);
  return normalized;
}
