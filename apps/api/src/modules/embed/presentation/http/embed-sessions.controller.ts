import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";

type IssueBody = { ttl_seconds?: number; merchant_id?: string };

@UseGuards(AuthGuard)
@Controller("embed-sessions")
export class EmbedSessionsController {
  constructor(private readonly issue: IssueEmbedSessionUseCase) {}

  @Post()
  issueSession(@Req() request: unknown, @Body() body: IssueBody) {
    const user = currentUser(request as { user?: unknown });
    const ttl = typeof body?.ttl_seconds === "number" && Number.isFinite(body.ttl_seconds) ? body.ttl_seconds : 900;
    return this.issue.execute({ merchantId: user.merchantId, ttlSeconds: ttl });
  }
}
