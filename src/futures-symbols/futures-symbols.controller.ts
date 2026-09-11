import { Controller, Get, Post, Query } from '@nestjs/common';
import { FuturesSymbolsService } from './futures-symbols.service';
import { FuturesSymbolsResponse } from './types/futures-symbol.type';
import type { ExchangeName } from 'src/exchange/exchange.service';

@Controller('futures-symbols')
export class FuturesSymbolsController {
  constructor(private readonly futuresSymbolsService: FuturesSymbolsService) {}

  @Post('fetch')
  async fetchSymbols(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<FuturesSymbolsResponse> {
    return this.futuresSymbolsService.fetchAndStoreSymbols(
      exchange ?? 'BINANCE',
    );
  }

  @Get()
  async getSymbols(
    @Query('exchange') exchange?: ExchangeName,
  ): Promise<FuturesSymbolsResponse | { message: string }> {
    const stored = await this.futuresSymbolsService.getStoredSymbols(
      exchange ?? 'BINANCE',
    );
    if (!stored) {
      return {
        message: 'No symbols stored yet. POST to /futures-symbols/fetch first.',
      };
    }
    return stored;
  }
}
