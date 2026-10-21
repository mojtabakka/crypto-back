import { Controller, Get, Query } from '@nestjs/common';
import { LongShortSignalService } from './long-short-signal.service';
import type { ExchangeName } from 'src/exchange/exchange.service';

@Controller('long-short-signals')
export class LongShortSignalController {
  constructor(private readonly longShortSignalService: LongShortSignalService) {}

  @Get()
  async getLatestSignals(@Query('exchange') exchange?: ExchangeName) {
    return this.longShortSignalService.getLatestSignals(exchange || 'binance');
  }

  @Get('longs')
  async getLongSignals(@Query('exchange') exchange?: ExchangeName) {
    return this.longShortSignalService.getLongSignals(exchange || 'binance');
  }

  @Get('shorts')
  async getShortSignals(@Query('exchange') exchange?: ExchangeName) {
    return this.longShortSignalService.getShortSignals(exchange || 'binance');
  }

  @Get('scan')
  async triggerScan(@Query('exchange') exchange?: ExchangeName) {
    return this.longShortSignalService.triggerScan(exchange || 'binance');
  }
}