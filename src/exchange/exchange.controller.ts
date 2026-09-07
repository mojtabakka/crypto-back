import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ExchangeService } from './exchange.service';
import type { ExchangeName } from './exchange.service';
import { BinanceKline } from 'src/market/dto/binance-kline.type';

@ApiTags('exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly exchangeService: ExchangeService) {}

  @Get('klines')
  @ApiOperation({ summary: 'Get klines from selected exchange' })
  @ApiQuery({ name: 'symbol', required: true, type: String })
  @ApiQuery({ name: 'interval', required: true, type: String })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getKlines(
    @Query('symbol') symbol: string,
    @Query('interval') interval: string,
    @Query('exchange') exchange?: ExchangeName,
    @Query('limit') limit?: number,
  ): Promise<BinanceKline[]> {
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000;

    return this.exchangeService.getKlines(
      symbol,
      interval,
      startTime,
      endTime,
      exchange ?? 'BINANCE',
      limit ?? 1000,
    );
  }

  @Get('list')
  @ApiOperation({ summary: 'Get list of available exchanges' })
  async getExchanges(): Promise<{ exchanges: ExchangeName[] }> {
    return { exchanges: this.exchangeService.getAvailableExchanges() };
  }

  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get circuit breaker status for all exchanges' })
  getCircuitBreakers() {
    return this.exchangeService.getCircuitBreakerStatus();
  }

  @Post('circuit-breakers/reset')
  @ApiOperation({ summary: 'Manually reset circuit breakers' })
  @ApiQuery({ name: 'exchange', required: false, type: String })
  resetCircuitBreaker(@Query('exchange') exchange?: ExchangeName) {
    if (exchange) {
      return this.exchangeService.resetCircuitBreaker(exchange);
    }
    this.exchangeService.resetAllCircuitBreakers();
    return { message: 'All circuit breakers reset' };
  }
}
