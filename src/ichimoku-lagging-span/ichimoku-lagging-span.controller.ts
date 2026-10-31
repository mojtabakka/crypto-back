import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuLaggingSpanService } from './ichimoku-lagging-span.service';
import type { IchimokuLaggingSpanScanResult } from './types/ichimoku-lagging-span.types';

@Controller('ichimoku-lagging-span')
export class IchimokuLaggingSpanController {
  constructor(private readonly scanner: IchimokuLaggingSpanService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
  ): Promise<IchimokuLaggingSpanScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
    });
  }
}
