import { HttpException, HttpStatus } from "@nestjs/common";

export class PreconditionRequiredException extends HttpException {
  constructor(detail = "The If-Match header is required for this operation.") {
    super(
      {
        code: "precondition_required",
        detail,
      },
      428,
    );
  }
}

export class PreconditionFailedException extends HttpException {
  constructor(detail = "The resource changed since it was last read.") {
    super(
      {
        code: "precondition_failed",
        detail,
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}

export class OptimisticConcurrencyError extends Error {
  readonly code = "precondition_failed";

  constructor() {
    super("The resource changed since it was last read.");
    this.name = "OptimisticConcurrencyError";
  }
}
