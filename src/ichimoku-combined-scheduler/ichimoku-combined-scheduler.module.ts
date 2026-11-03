import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IchimokuCombinedModule } from '../ichimoku-combined/ichimoku-combined.module';
import { NotificationModule } from '../notification/notification.module';
import { IchimokuCombinedSchedulerService } from './ichimoku-combined-scheduler.service';
import { IchimokuCombinedSchedulerController } from './ichimoku-combined-scheduler.controller';
import { TelegramController } from '../notification/telegram.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    IchimokuCombinedModule,
    NotificationModule,
  ],
  controllers: [IchimokuCombinedSchedulerController, TelegramController],
  providers: [IchimokuCombinedSchedulerService],
  exports: [IchimokuCombinedSchedulerService],
})
export class IchimokuCombinedSchedulerModule {}
