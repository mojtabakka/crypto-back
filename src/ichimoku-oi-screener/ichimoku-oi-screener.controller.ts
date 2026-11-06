import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuOiScreenerService } from './ichimoku-oi-screener.service';
import type { IchimokuOIScanResult } from './types/ichimoku-oi-screener.types';

@Controller('ichimoku-oi-screener')
export class IchimokuOiScreenerController {
  constructor(private readonly screener: IchimokuOiScreenerService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuOIScanResult> {
    return this.screener.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
