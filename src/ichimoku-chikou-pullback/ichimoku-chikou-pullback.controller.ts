import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuChikouPullbackService } from './ichimoku-chikou-pullback.service';
import type { IchimokuChikouPullbackScanResult } from './types/ichimoku-chikou-pullback.types';

@Controller('ichimoku-chikou-pullback')
export class IchimokuChikouPullbackController {
  constructor(private readonly scanner: IchimokuChikouPullbackService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuChikouPullbackScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }

  @Get('send-to-telegram')
  async sendToTelegram(
    @Query('interval') interval: string = '1d',
    @Query('chatId') chatId?: string,
    @Query('exchange') exchange?: string,
  ) {
    return this.scanner.sendToTelegram(interval, chatId || '', exchange);
  }
}
