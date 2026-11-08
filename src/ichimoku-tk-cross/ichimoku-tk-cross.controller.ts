import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuTkCrossService } from './ichimoku-tk-cross.service';
import type { IchimokuTkCrossScanResult } from './types/ichimoku-tk-cross.types';

@Controller('ichimoku-tk-cross')
export class IchimokuTkCrossController {
  constructor(private readonly scanner: IchimokuTkCrossService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuTkCrossScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
