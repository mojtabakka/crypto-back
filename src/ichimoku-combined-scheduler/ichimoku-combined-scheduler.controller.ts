import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuCombinedSchedulerService } from './ichimoku-combined-scheduler.service';

@Controller('ichimoku-combined-scheduler')
export class IchimokuCombinedSchedulerController {
  constructor(private readonly scheduler: IchimokuCombinedSchedulerService) {}

  @Get('send-to-telegram')
  async sendToTelegram(
    @Query('interval') interval: string = '4h',
    @Query('chatId') chatId?: string,
    @Query('exchange') exchange?: string,
  ) {
    return this.scheduler.sendToTelegram(interval, chatId || '', exchange);
  }
}
