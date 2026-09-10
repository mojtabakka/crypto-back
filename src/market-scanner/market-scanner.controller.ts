import { Controller, Get, Query } from '@nestjs/common';
import { MarketScannerService } from './market-scanner.service';

@Controller('market-scanner')
export class MarketScannerController {
  constructor(private readonly marketScannerService: MarketScannerService) {}

  @Get()
  async scanMarket(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanMarket(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('reliable')
  async scanMarketReliable(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanMarketReliable(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('fake-signals')
  async scanFakeSignals(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '50', 10);
    return this.marketScannerService.scanFakeSignals(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('pullbacks')
  async scanPullbacks(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacks(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('reapproach')
  async scanReapproach(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproach(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('weekly-pullbacks')
  async scanWeeklyPullbacks(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacksWeekly(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('weekly-reapproach')
  async scanWeeklyReapproach(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproachWeekly(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('4h-pullbacks')
  async scan4hPullbacks(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacks4h(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('4h-reapproach')
  async scan4hReapproach(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproach4h(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('monthly-pullbacks')
  async scanMonthlyPullbacks(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacksMonthly(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('monthly-reapproach')
  async scanMonthlyReapproach(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproachMonthly(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('weekly-above-ema50')
  async scanWeeklyAboveEma50(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '30', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('weekly-above-ema21')
  async scanWeeklyAboveEma21(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '50', 10);
    return this.marketScannerService.scanForWeeklyAboveEma21(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('pullbacks-ema21')
  async scanPullbacksEma21(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
    @Query('interval') interval?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '30', 10);
    const tf = (interval === '4h' || interval === '1w' ? interval : '1d') as
      | '1d'
      | '4h'
      | '1w';
    return this.marketScannerService.scanForPullbacksEma21(
      parsedLimit,
      exchange ?? 'BINANCE',
      tf,
    );
  }

  @Get('reapproach-ema21')
  async scanReapproachEma21(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
    @Query('interval') interval?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '30', 10);
    const tf = (interval === '4h' || interval === '1w' ? interval : '1d') as
      | '1d'
      | '4h'
      | '1w';
    return this.marketScannerService.scanForReapproachEma21(
      parsedLimit,
      exchange ?? 'BINANCE',
      tf,
    );
  }

  @Get('daily-above-ema50-long')
  async scanDailyAboveEma50Long(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForDailyAboveEma50WithLong(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }

  @Get('weekly-above-ema50-long')
  async scanWeeklyAboveEma50Long(
    @Query('limit') limit?: string,
    @Query('exchange') exchange?: string,
  ) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50WithLong(
      parsedLimit,
      exchange ?? 'BINANCE',
    );
  }
}
