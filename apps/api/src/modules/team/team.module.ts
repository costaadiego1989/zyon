import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { InviteMemberUseCase, EMAIL_SENDER_PORT } from "./application/use-cases/invite-member.use-case.js";
import { AcceptInviteUseCase } from "./application/use-cases/accept-invite.use-case.js";
import { ListTeamUseCase } from "./application/use-cases/list-team.use-case.js";
import { UpdateRoleUseCase } from "./application/use-cases/update-role.use-case.js";
import { RemoveMemberUseCase } from "./application/use-cases/remove-member.use-case.js";
import { TeamController } from "./presentation/http/team.controller.js";
import { ResendEmailAdapter } from "../notifications/infrastructure/adapters/resend-email.adapter.js";

@Module({
  imports: [PersistenceModule],
  controllers: [TeamController],
  providers: [
    InviteMemberUseCase,
    AcceptInviteUseCase,
    ListTeamUseCase,
    UpdateRoleUseCase,
    RemoveMemberUseCase,
    {
      provide: EMAIL_SENDER_PORT,
      useClass: ResendEmailAdapter,
    },
  ],
  exports: [
    InviteMemberUseCase,
    AcceptInviteUseCase,
    ListTeamUseCase,
    UpdateRoleUseCase,
    RemoveMemberUseCase,
  ],
})
export class TeamModule {}
