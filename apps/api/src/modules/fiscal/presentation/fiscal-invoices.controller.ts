import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import type { TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { FiscalMerchantInvoicesService } from "../application/fiscal-merchant-invoices.service.js";
import { fiscalHttp, fiscalHttpActor } from "./fiscal-http.js";
@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("merchants/me/fiscal/invoices")
export class FiscalInvoicesController {
  constructor(private readonly invoices: FiscalMerchantInvoicesService) {}
  @Get() list(
    @Req() req: TenantPrincipalRequest,
    @Query()
    query: {
      environment: string;
      state?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    }
  ) {
    const { scope } = fiscalHttpActor(req, query.environment);
    return fiscalHttp(() =>
      this.invoices.list(scope, {
        state: query.state,
        search: query.search,
        page: query.page === undefined ? undefined : Number(query.page),
        pageSize:
          query.pageSize === undefined ? undefined : Number(query.pageSize),
      })
    );
  }
  @Get(":id") detail(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Query("environment") environment: string
  ) {
    const { scope, actor } = fiscalHttpActor(req, environment);
    return fiscalHttp(() => this.invoices.detail(scope, id, actor));
  }
  @Post(":id/reconcile") reconcile(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body() body: { environment: string }
  ) {
    const { scope, actor } = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() => this.invoices.reconcile(scope, id, actor));
  }
  @Post(":id/reprocess") reprocess(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body() body: { environment: string; profileVersionId: string }
  ) {
    const { scope, actor } = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.invoices.reprocess(scope, id, body.profileVersionId, actor)
    );
  }
  @Post(":id/cancellation") cancellation(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body()
    body: {
      environment: string;
      reviewId: string;
      confirmed: boolean;
      justification: string;
    }
  ) {
    const { scope, actor } = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.invoices.requestCancellation(scope, id, actor, {
        reviewId: body.reviewId,
        confirmed: body.confirmed,
        justification: body.justification,
      })
    );
  }
  @Get(":id/documents/:kind") async download(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Query("environment") environment: string,
    @Res({ passthrough: true }) res: Response
  ) {
    const { scope, actor } = fiscalHttpActor(req, environment);
    return fiscalHttp(async () => {
      if (kind !== "xml" && kind !== "danfe")
        throw new Error("fiscal_document_kind_invalid");
      const file = await this.invoices.documents.download(
        {
          kind: "merchant",
          merchantId: scope.merchantId,
          actorId: actor.actorId,
          permissions: ["fiscal.read"],
        },
        scope,
        id,
        kind
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(Buffer.from(file.bytes), {
        type: file.mimeType,
        disposition: `attachment; filename="nota-fiscal.${
          kind === "xml" ? "xml" : "pdf"
        }"`,
        length: file.bytes.length,
      });
    });
  }
}
