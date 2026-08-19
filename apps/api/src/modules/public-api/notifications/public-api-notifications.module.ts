import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../notifications/notifications.module.js";
import { NotificationsV1Controller } from "./presentation/http/notifications-v1.controller.js";

@Module({
  imports: [NotificationsModule],
  controllers: [NotificationsV1Controller],
})
export class PublicApiNotificationsModule {}
