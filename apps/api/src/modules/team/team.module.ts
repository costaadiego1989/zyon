import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { InviteMemberUseCase } from "./application/use-cases/invite-member.use-case.js";
import { AcceptInviteUseCase } from "./application/use-cases/accept-invite.use-case.js";
import { ListTeamUseCase } from "./application/use-cases/list-team.use-case.js";
import { UpdateRoleUseCase } from "./application/use-cases/update-role.use-case.js";
import { RemoveMemberUseCase } from "./application/use-cases/remove-member.use-case.js";
import { TeamController } from "./presentation/http/team.controller.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [PersistenceModule, NotificationsModule, AuthModule],
  controllers: [TeamController],
  providers: [
    InviteMemberUseCase,
    AcceptInviteUseCase,
    ListTeamUseCase,
    UpdateRoleUseCase,
    RemoveMemberUseCase,
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
