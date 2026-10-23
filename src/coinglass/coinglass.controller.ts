import { Controller, Get, Query } from '@nestjs/common';
import { CoinGlassService } from './coinglass.service';

@Controller('coinglass')
export class CoinGlassController {
  constructor(private readonly coinglassService: CoinGlassService) {}

  @Get('signals')
  async getSignals(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 200;
    return this.coinglassService.scanCoinGlassSignals(parsedLimit);
  }

  @Get('longs')
  async getLongs(@Query('limit') limit?: string) {
    const result = await this.coinglassService.scanCoinGlassSignals(limit ? parseInt(limit, 10) : 200);
    return result.longs;
  }

  @Get('shorts')
  async getShorts(@Query('limit') limit?: string) {
    const result = await this.coinglassService.scanCoinGlassSignals(limit ? parseInt(limit, 10) : 200);
    return result.shorts;
  }

  @Get('indices')
  async getIndices() {
    return this.coinglassService.getGlobalIndices();
  }
}
