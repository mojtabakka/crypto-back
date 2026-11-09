import { Controller, Get, Header, Query } from '@nestjs/common';
import { MarketScannerService } from './market-scanner.service';
import { ScannerExtrasService } from './scanner-extras.service';

@Controller('market-scanner')
export class MarketScannerController {
  constructor(
    private readonly marketScannerService: MarketScannerService,
    private readonly extras: ScannerExtrasService,
  ) {}

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

  @Get('reliable')
  async reliable(@Query('limit') limit?: string) {
    return this.extras.reliable(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('shorts')
  async shorts(
    @Query('timeframe') timeframe?: string,
    @Query('limit') limit?: string,
  ) {
    return this.extras.shorts(timeframe ?? 'combined', parseInt(limit ?? '30', 10) || 30);
  }

  @Get('fake-signals')
  async fakeSignals(@Query('limit') limit?: string) {
    return this.extras.fakeSignals(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('funding-extreme')
  async fundingExtreme(@Query('limit') limit?: string) {
    return this.extras.fundingExtreme(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('strong')
  async strong(@Query('limit') limit?: string) {
    return this.extras.strong(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('trusted-long-short')
  async trusted(@Query('limit') limit?: string) {
    return this.extras.trusted(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('doji-candles')
  async doji(@Query('limit') limit?: string) {
    return this.extras.doji(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('funding-volume-squeeze')
  async squeeze(@Query('limit') limit?: string) {
    return this.extras.fundingVolumeSqueeze(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('btc-candle-sequence')
  async btcSequence(@Query('limit') limit?: string) {
    return this.extras.btcSequence(parseInt(limit ?? '1000', 10) || 1000);
  }

  @Get('liquidation-clusters')
  async liquidationClusters(@Query('limit') limit?: string) {
    return this.extras.liquidationClusters(parseInt(limit ?? '30', 10) || 30);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="signals.csv"')
  async export(
    @Query('type') type = 'signals',
    @Query('limit') limit?: string,
  ) {
    return this.extras.exportCsv(type, parseInt(limit ?? '30', 10) || 30);
  }

  @Get('weekly-above-ema50')
  async scanWeeklyAboveEma50(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '30', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50(parsedLimit);
  }

  @Get('daily-above-ema50-long')
  async scanDailyAboveEma50Long(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForDailyAboveEma50WithLong(
      parsedLimit,
    );
  }

  @Get('weekly-above-ema50-long')
  async scanWeeklyAboveEma50Long(@Query('limit') limit?: string) {
    const parsedLimit = parseInt(limit ?? '20', 10);
    return this.marketScannerService.scanForWeeklyAboveEma50WithLong(
      parsedLimit,
    );
  }
}
