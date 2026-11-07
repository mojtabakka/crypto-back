import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuBreakoutService } from './ichimoku-breakout.service';
import type { IchimokuBreakoutScanResult } from './types/ichimoku-breakout.types';

@Controller('ichimoku-breakout')
export class IchimokuBreakoutController {
  constructor(private readonly scanner: IchimokuBreakoutService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuBreakoutScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
