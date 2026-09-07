import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { ExchangeName } from 'src/exchange/exchange.service';
import { DumpDetectorService } from './dump-detector.service';
import { DumpAlertEntity } from './entities/dump-alert.entity';

@ApiTags('dump-detector')
@Controller('dump-detector')
export class DumpDetectorController {
  constructor(private readonly dumpDetectorService: DumpDetectorService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Get all dump alerts' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  @ApiQuery({ name: 'minScore', required: false, type: Number })
  async getAlerts(
    @Query('exchange') exchange?: ExchangeName,
    @Query('minScore') minScore?: number,
  ): Promise<DumpAlertEntity[]> {
    return this.dumpDetectorService.getRecentAlerts(exchange, minScore ?? 0);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active dump alerts (last 4 hours)' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  async getActiveAlerts(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<DumpAlertEntity[]> {
    return this.dumpDetectorService.getActiveAlerts(exchange);
  }

  @Get('scan')
  @ApiOperation({ summary: 'Manually trigger dump scan for selected exchange' })
  @ApiQuery({ name: 'exchange', required: true, type: String })
  async triggerScan(@Query('exchange') exchange: ExchangeName) {
    if (!exchange) {
      return { message: 'Exchange parameter is required', count: 0, alerts: [] };
    }
    const alerts = await this.dumpDetectorService.scanExchange(exchange);
    return {
      message: `Scan complete for ${exchange}`,
      count: alerts.length,
      alerts,
    };
  }
}
