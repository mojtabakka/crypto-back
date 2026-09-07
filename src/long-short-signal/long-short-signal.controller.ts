import { Controller, Get, Query } from '@nestjs/common';
import { LongShortSignalService } from './long-short-signal.service';

@Controller('long-short-signals')
export class LongShortSignalController {
  constructor(
    private readonly longShortSignalService: LongShortSignalService,
  ) {}

  @Get()
  async getLatestSignals(@Query('exchange') exchange?: string) {
    return this.longShortSignalService.getLatestSignals(exchange);
  }

  @Get('longs')
  async getLongSignals(@Query('exchange') exchange?: string) {
    return this.longShortSignalService.getLongSignals(exchange);
  }

  @Get('shorts')
  async getShortSignals(@Query('exchange') exchange?: string) {
    return this.longShortSignalService.getShortSignals(exchange);
  }

  @Get('scan')
  async scanForExchange(@Query('exchange') exchange?: string) {
    const ex = exchange ?? 'BINANCE';
    return this.longShortSignalService.scanForExchange(ex);
  }
}
