import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { ExchangeName } from 'src/exchange/exchange.service';
import { SafeSellService } from './safe-sell.service';

@ApiTags('safe-sell')
@Controller('safe-sell')
export class SafeSellController {
  constructor(private readonly safeSellService: SafeSellService) {}

  @Get('signals')
  @ApiOperation({ summary: 'Get recent safe-sell signals' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  @ApiQuery({ name: 'symbol', required: false, type: String })
  async getSignals(
    @Query('exchange') exchange?: ExchangeName,
    @Query('symbol') symbol?: string,
  ) {
    return this.safeSellService.getRecentSignals(exchange, symbol);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active safe-sell signals (last 4 hours)' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  @ApiQuery({ name: 'symbol', required: false, type: String })
  async getActiveSignals(
    @Query('exchange') exchange?: ExchangeName,
    @Query('symbol') symbol?: string,
  ) {
    return this.safeSellService.getActiveSignals(exchange, symbol);
  }

  @Get('scan')
  @ApiOperation({
    summary: 'Manually trigger safe-sell scan for selected exchange',
  })
  @ApiQuery({ name: 'exchange', required: true, type: String })
  async triggerScan(@Query('exchange') exchange: ExchangeName) {
    if (!exchange) {
      return {
        message: 'Exchange parameter is required',
        count: 0,
        signals: [],
      };
    }
    const signals = await this.safeSellService.scanExchange(exchange);
    return {
      message: `Scan complete for ${exchange}`,
      count: signals.length,
      signals,
    };
  }
}
