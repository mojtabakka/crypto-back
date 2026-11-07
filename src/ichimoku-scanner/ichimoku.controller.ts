import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuScannerService } from './ichimoku.service';
import type {
  IchimokuNearCloudBottomScanResult,
  IchimokuScanResult,
} from './types/ichimoku.types';

@Controller('ichimoku-scanner')
export class IchimokuScannerController {
  constructor(private readonly scanner: IchimokuScannerService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }

  @Get('near-cloud-bottom')
  async nearCloudBottom(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
    @Query('thresholdPct') thresholdPct?: string,
  ): Promise<IchimokuNearCloudBottomScanResult> {
    return this.scanner.scanNearCloudBottom({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
      thresholdPct: thresholdPct ? Number(thresholdPct) : undefined,
    });
  }
}
