import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuBullishScanService } from './ichimoku-bullish-scan.service';
import type {
  IchimokuBullishScanParams,
  IchimokuBullishScanResult,
} from './types/ichimoku-bullish-scan.types';

@Controller('ichimoku-bullish-scan')
export class IchimokuBullishScanController {
  constructor(private readonly scanner: IchimokuBullishScanService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
    @Query('lookbackBars') lookbackBars?: string,
    @Query('minVolumeRatio') minVolumeRatio?: string,
  ): Promise<IchimokuBullishScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
      lookbackBars: lookbackBars ? Number(lookbackBars) : undefined,
      minVolumeRatio: minVolumeRatio ? Number(minVolumeRatio) : undefined,
    });
  }
}
