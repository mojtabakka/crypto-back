import { Module } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { TelegramService } from './telegram.service';

@Module({
  providers: [NotificationGateway, TelegramService],
  exports: [NotificationGateway, TelegramService],
})
export class NotificationModule {}
