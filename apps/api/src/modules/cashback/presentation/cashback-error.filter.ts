import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import { CashbackError } from "../domain/cashback.js";

@Catch(CashbackError)
export class CashbackErrorFilter implements ExceptionFilter {
  catch(error: CashbackError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(error.status).json({ statusCode: error.status, code: error.code, message: error.code });
  }
}
