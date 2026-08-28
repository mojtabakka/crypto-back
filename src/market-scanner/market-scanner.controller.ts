import { Controller, Get, Query } from '@nestjs/common';
import { MarketScannerService } from './market-scanner.service';

@Controller('market-scanner')
export class MarketScannerController {
  constructor(private readonly marketScannerService: MarketScannerService) {}

  @Get()
  async scanMarket(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanMarket(parsedLimit);
  }

  @Get('pullbacks')
  async scanPullbacks(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacks(parsedLimit);
  }

  @Get('reapproach')
  async scanReapproach(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproach(parsedLimit);
  }

  @Get('weekly-pullbacks')
  async scanWeeklyPullbacks(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacksWeekly(parsedLimit);
  }

  @Get('weekly-reapproach')
  async scanWeeklyReapproach(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproachWeekly(parsedLimit);
  }

  @Get('4h-pullbacks')
  async scan4hPullbacks(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacks4h(parsedLimit);
  }

  @Get('4h-reapproach')
  async scan4hReapproach(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproach4h(parsedLimit);
  }

  @Get('monthly-pullbacks')
  async scanMonthlyPullbacks(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForPullbacksMonthly(parsedLimit);
  }

  @Get('monthly-reapproach')
  async scanMonthlyReapproach(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForReapproachMonthly(parsedLimit);
  }

  @Get('weekly-above-ema50')
  async scanWeeklyAboveEma50(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '30', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50(parsedLimit);
  }

  @Get('daily-above-ema50-long')
  async scanDailyAboveEma50Long(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForDailyAboveEma50WithLong(parsedLimit);
  }

  @Get('weekly-above-ema50-long')
  async scanWeeklyAboveEma50Long(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50WithLong(parsedLimit);
  }
}
