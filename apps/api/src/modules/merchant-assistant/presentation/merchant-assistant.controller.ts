import { Body, Catch, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { AssistantTurnInput } from '@zyon/shared-types';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { currentTenantPrincipal, type TenantPrincipalRequest } from '../../../shared/auth/tenant-principal.js';
import { MetaAdsError } from '../../meta-ads-agent/domain/types.js';
import { AssistantError, type AssistantScope } from '../domain/assistant.port.js';
import { AssistantApiService } from '../application/assistant-api.service.js';

type Request = TenantPrincipalRequest & { headers?: { authorization?: string; origin?: string } };
@Catch(AssistantError, MetaAdsError)
export class AssistantHttpErrorFilter implements ExceptionFilter {
  catch(error: AssistantError | MetaAdsError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(error.status).json({ code: error.code, message: error.code });
  }
}
const integer = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,8}$/.test(value)) throw new AssistantError('assistant_page_invalid');
  return Number(value);
};
@Controller('merchant-assistant/contexts/:context')
@UseGuards(AuthGuard)
@UseFilters(AssistantHttpErrorFilter)
export class MerchantAssistantController {
  constructor(@Inject(AssistantApiService) private readonly api: AssistantApiService) {}
  private scope(request: Request, context: string, mutation = false): AssistantScope {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== 'human' || !['owner', 'admin'].includes(principal.role)) throw new ForbiddenException('assistant_role_forbidden');
    if (mutation && !request.headers?.authorization?.startsWith('Bearer ')) {
      let origin: string | null = null;
      try { origin = new URL(this.api.dashboardUrl).origin; } catch { /* Unconfigured cookie origin fails closed. */ }
      if (!origin || origin !== request.headers?.origin) throw new ForbiddenException('assistant_origin_forbidden');
    }
    return { merchantId: principal.tenantId, actorId: principal.userId, context };
  }
  @Get('thread') thread(@Req() request: Request, @Param('context') context: string) { return this.api.thread(this.scope(request, context)); }
  @Get('threads/:id/turns') page(@Req() request: Request, @Param('context') context: string, @Param('id') id: string, @Query('limit') limit?: string, @Query('before') before?: string) {
    const scope = this.scope(request, context); return this.api.page(scope, id, { limit: integer(limit), before: integer(before) });
  }
  @Post('threads/:id/turns') @HttpCode(202)
  submit(@Req() request: Request, @Param('context') context: string, @Param('id') id: string, @Body() body: AssistantTurnInput) {
    return this.api.submit(this.scope(request, context, true), id, body);
  }
  @Get('sources/:sourceId') source(@Req() request: Request, @Param('context') context: string, @Param('sourceId') sourceId: string) {
    return this.api.source(this.scope(request, context), sourceId);
  }
}
