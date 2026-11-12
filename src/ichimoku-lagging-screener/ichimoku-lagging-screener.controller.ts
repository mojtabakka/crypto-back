import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { IchimokuLaggingScreenerService } from './ichimoku-lagging-screener.service';
import type {
  IchimokuLaggingScanParams,
  IchimokuLaggingScanResult,
} from './types/ichimoku-lagging-screener.types';

@Controller('ichimoku-lagging-screener')
export class IchimokuLaggingScreenerController {
  constructor(private readonly screener: IchimokuLaggingScreenerService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuLaggingScanResult> {
    return this.screener.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
