import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../../integrations/integrations.module.js";
import { NotificationsModule } from "../../notifications/notifications.module.js";
import { NotificationsV1Controller } from "./presentation/http/notifications-v1.controller.js";

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [NotificationsV1Controller],
})
export class PublicApiNotificationsModule {}
