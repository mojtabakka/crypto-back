import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuScannerService } from './ichimoku.service';
import type { IchimokuScanResult } from './types/ichimoku.types';

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
}
