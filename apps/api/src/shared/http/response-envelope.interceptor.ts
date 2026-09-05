import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

export interface ApiResponseEnvelope<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: 'v1';
  };
  pagination?: {
    next_cursor?: string | null;
    has_more: boolean;
  };
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = (request as any).correlationId || `req_${Date.now()}`;

    return next.handle().pipe(
      map((response) => {
        if (response?.data !== undefined && response?.meta !== undefined) {
          return response;
        }

        const { pagination, ...dataPayload } = response || {};

        const envelope: ApiResponseEnvelope<any> = {
          data: Array.isArray(response) ? response : dataPayload,
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: 'v1',
          },
        };

        if (pagination) {
          envelope.pagination = pagination;
        }

        return envelope;
      }),
    );
  }
}
