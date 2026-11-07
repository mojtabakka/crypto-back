import { Controller, Get, Query } from '@nestjs/common';
import { IchimokuCloudBottomTouchService } from './ichimoku-cloud-bottom-touch.service';
import type { IchimokuCloudBottomTouchScanResult } from './types/ichimoku-cloud-bottom-touch.types';

@Controller('ichimoku-cloud-bottom-touch')
export class IchimokuCloudBottomTouchController {
  constructor(private readonly scanner: IchimokuCloudBottomTouchService) {}

  @Get('scan')
  async scan(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
    @Query('interval') interval?: string,
    @Query('exchange') exchange?: string,
  ): Promise<IchimokuCloudBottomTouchScanResult> {
    return this.scanner.scan({
      symbols,
      limit: limit ? Number(limit) : undefined,
      interval,
      exchange,
    });
  }
}
