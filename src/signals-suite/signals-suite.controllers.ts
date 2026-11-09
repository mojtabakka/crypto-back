import { Controller, Get, Query } from '@nestjs/common';
import { SignalsSuiteService } from './signals-suite.service';

@Controller('pump-detector')
export class PumpDetectorController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get('alerts')
  async alerts(
    @Query('minScore') minScore?: string,
    @Query('exchange') _exchange?: string,
  ) {
    const parsed = Number(minScore ?? 25);
    await this.ensureScan();
    return this.suite.getMovers('PUMP', Number.isFinite(parsed) ? parsed : 25);
  }

  @Get('scan')
  async scan(@Query('minScore') minScore?: string) {
    const parsed = Number(minScore ?? 25);
    return this.suite.scanMovers('PUMP', Number.isFinite(parsed) ? parsed : 25);
  }

  private async ensureScan() {
    // Alerts endpoint is polled; trigger a scan only when the cache is empty.
    if (this.suite.getMovers('PUMP').length === 0) {
      await this.suite.scanMovers('PUMP', 0);
    }
  }
}

@Controller('dump-detector')
export class DumpDetectorController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get('alerts')
  async alerts(
    @Query('minScore') minScore?: string,
    @Query('exchange') _exchange?: string,
  ) {
    const parsed = Number(minScore ?? 25);
    await this.ensureScan();
    return this.suite.getMovers('DUMP', Number.isFinite(parsed) ? parsed : 25);
  }

  @Get('scan')
  async scan(@Query('minScore') minScore?: string) {
    const parsed = Number(minScore ?? 25);
    return this.suite.scanMovers('DUMP', Number.isFinite(parsed) ? parsed : 25);
  }

  private async ensureScan() {
    if (this.suite.getMovers('DUMP').length === 0) {
      await this.suite.scanMovers('DUMP', 0);
    }
  }
}

@Controller('pre-move-detector')
export class PreMoveDetectorController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get('signals')
  signals(
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    const confidence = Number(minConfidence ?? 40);
    const size = Number(limit ?? 80);
    return this.suite.getPreMove(
      Number.isFinite(confidence) ? confidence : 40,
      Number.isFinite(size) ? size : 80,
    );
  }

  @Get('scan')
  scan() {
    return this.suite.scanPreMove();
  }
}

@Controller('safe-sell')
export class SafeSellController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get('signals')
  async signals(
    @Query('symbol') symbol?: string,
    @Query('exchange') _exchange?: string,
  ) {
    if ((this.suite.getSafeSell().length ?? 0) === 0) {
      await this.suite.scanSafeSell();
    }
    return this.suite.getSafeSell(symbol);
  }

  @Get('scan')
  scan() {
    return this.suite.scanSafeSell();
  }
}

@Controller('pressure-scan')
export class PressureScanController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get()
  async scan(@Query('limit') limit?: string) {
    const size = Number(limit ?? 100);
    await this.suite.scanPressure();
    return {
      ...this.suite.getPressure(Number.isFinite(size) ? size : 100),
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

@Controller('coinglass')
export class CoinGlassController {
  constructor(private readonly suite: SignalsSuiteService) {}

  @Get('signals')
  async signals(@Query('limit') limit?: string) {
    const size = Number(limit ?? 200);
    await this.suite.scanCoinGlass(Number.isFinite(size) ? size : 200);
    return this.suite.getCoinGlass(Number.isFinite(size) ? size : 200);
  }
}
