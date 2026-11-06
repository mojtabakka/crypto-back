import { Controller, Get, Query } from '@nestjs/common';
import { SymbolOiMonitorService } from './symbol-oi-monitor.service';
import type { SymbolOIStatus } from './types/symbol-oi-monitor.types';

@Controller('symbol-oi-monitor')
export class SymbolOiMonitorController {
  constructor(private readonly monitor: SymbolOiMonitorService) {}

  @Get('status')
  async status(
    @Query('symbol') symbol: string,
    @Query('lookbackMinutes') lookbackMinutes?: string,
  ): Promise<SymbolOIStatus> {
    if (!symbol) {
      throw new Error('symbol query parameter is required');
    }

    return this.monitor.getStatus({
      symbol,
      lookbackMinutes: lookbackMinutes ? Number(lookbackMinutes) : undefined,
    });
  }
}
