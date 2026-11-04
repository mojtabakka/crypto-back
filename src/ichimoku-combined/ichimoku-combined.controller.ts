import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuCombinedService } from './ichimoku-combined.service';
import type { IchimokuCombinedScanResult } from './types/ichimoku-combined.types';

@Controller('ichimoku-combined')
export class IchimokuCombinedController {
  constructor(private readonly scanner: IchimokuCombinedService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuCombinedScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
