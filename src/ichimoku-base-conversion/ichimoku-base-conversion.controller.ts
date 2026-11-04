import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuBaseConversionService } from './ichimoku-base-conversion.service';
import type { IchimokuBaseConversionScanResult } from './types/ichimoku-base-conversion.types';

@Controller('ichimoku-base-conversion')
export class IchimokuBaseConversionController {
  constructor(private readonly scanner: IchimokuBaseConversionService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuBaseConversionScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
