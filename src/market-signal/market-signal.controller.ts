import { Controller, Get, Query } from '@nestjs/common';

import { MarketSignalService } from './market-signal.service';

@Controller('market-signal')
export class MarketSignalController {
  constructor(private readonly marketSignalService: MarketSignalService) {}

  @Get()
  async getSignal(
    @Query('symbol')
    symbol = 'BTCUSDT',
  ) {
    const endTime = Date.now();

    const startTime = endTime - 24 * 60 * 60 * 1000;

    return this.marketSignalService.analyzeSymbol(symbol, startTime, endTime);
  }
}
