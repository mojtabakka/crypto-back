import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuService } from './ichimoku.service';

const parseLimit = (limit?: string, fallback = 80) => {
  const parsed = Number(limit ?? fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 300) : fallback;
};

@Controller('ichimoku-scanner')
export class IchimokuScannerController {
  constructor(private readonly ichimoku: IchimokuService) {}

  @Get('scan')
  scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
  ) {
    return this.ichimoku.scan(symbols, parseLimit(limit), interval ?? '1h');
  }
}

@Controller('ichimoku-lagging-span')
export class IchimokuLaggingSpanController {
  constructor(private readonly ichimoku: IchimokuService) {}

  @Get('scan')
  scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
  ) {
    return this.ichimoku.scanLaggingSpan(symbols, parseLimit(limit), interval ?? '1h');
  }
}

@Controller('ichimoku-combined')
export class IchimokuCombinedController {
  constructor(private readonly ichimoku: IchimokuService) {}

  @Get('scan')
  scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
  ) {
    return this.ichimoku.scanCombined(symbols, parseLimit(limit), interval ?? '1h');
  }
}
