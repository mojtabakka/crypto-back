import { Controller, Get, Post } from '@nestjs/common';
import { FuturesSymbolsService } from './futures-symbols.service';
import { FuturesSymbolsResponse } from './types/futures-symbol.type';

@Controller('futures-symbols')
export class FuturesSymbolsController {
  constructor(private readonly futuresSymbolsService: FuturesSymbolsService) {}

  @Post('fetch')
  async fetchSymbols(): Promise<FuturesSymbolsResponse> {
    return this.futuresSymbolsService.fetchAndStoreSymbols();
  }

  @Get()
  async getSymbols(): Promise<FuturesSymbolsResponse | { message: string }> {
    const stored = await this.futuresSymbolsService.getStoredSymbols();
    if (!stored) {
      return {
        message: 'No symbols stored yet. POST to /futures-symbols/fetch first.',
      };
    }
    return stored;
  }
}
