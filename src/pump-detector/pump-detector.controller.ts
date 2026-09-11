import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { ExchangeName } from 'src/exchange/exchange.service';
import { PumpDetectorService } from './pump-detector.service';
import { PumpAlertEntity } from './entities/pump-alert.entity';

@ApiTags('pump-detector')
@Controller('pump-detector')
export class PumpDetectorController {
  constructor(private readonly pumpDetectorService: PumpDetectorService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Get all pump alerts' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  @ApiQuery({ name: 'minScore', required: false, type: Number })
  async getAlerts(
    @Query('exchange') exchange?: ExchangeName,
    @Query('minScore') minScore?: number,
  ): Promise<PumpAlertEntity[]> {
    return this.pumpDetectorService.getRecentAlerts(exchange, minScore ?? 0);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active pump alerts (last 4 hours)' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  async getActiveAlerts(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<PumpAlertEntity[]> {
    return this.pumpDetectorService.getActiveAlerts(exchange);
  }

  @Get('scan')
  @ApiOperation({ summary: 'Manually trigger pump scan for selected exchange' })
  @ApiQuery({ name: 'exchange', required: true, type: String })
  async triggerScan(@Query('exchange') exchange: ExchangeName) {
    if (!exchange) {
      return {
        message: 'Exchange parameter is required',
        count: 0,
        alerts: [],
      };
    }
    const alerts = await this.pumpDetectorService.scanExchange(exchange);
    return {
      message: `Scan complete for ${exchange}`,
      count: alerts.length,
      alerts,
    };
  }
}
