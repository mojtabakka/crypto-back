import { Controller, Get, Query } from '@nestjs/common';
import { TVLAnalyzerService } from './tvl-analyzer.service';
import type {
  TVLScanResult,
  TVLAnalysisResult,
} from './types/tvl-analysis.types';

@Controller('tvl-analysis')
export class TVLAnalysisController {
  constructor(private readonly tvlAnalyzerService: TVLAnalyzerService) {}

  @Get('scan')
  async scanAll(): Promise<TVLScanResult> {
    return this.tvlAnalyzerService.analyzeAllProtocols();
  }

  @Get('top-opportunities')
  async getTopOpportunities(
    @Query('limit') limit = 10,
  ): Promise<TVLAnalysisResult[]> {
    return this.tvlAnalyzerService.getTopOpportunities(limit);
  }

  @Get('top-by-tvl')
  async getTopByTVL(@Query('limit') limit = 20): Promise<TVLScanResult> {
    const result = await this.tvlAnalyzerService.analyzeAllProtocols();
    return {
      ...result,
      topByTVL: result.topByTVL.slice(0, limit),
    };
  }

  @Get('top-by-growth')
  async getTopByGrowth(@Query('limit') limit = 20): Promise<TVLScanResult> {
    const result = await this.tvlAnalyzerService.analyzeAllProtocols();
    return {
      ...result,
      topByGrowth: result.topByGrowth.slice(0, limit),
    };
  }

  @Get('undervalued')
  async getUndervalued(@Query('limit') limit = 20): Promise<TVLScanResult> {
    const result = await this.tvlAnalyzerService.analyzeAllProtocols();
    return {
      ...result,
      undervalued: result.undervalued.slice(0, limit),
    };
  }

  @Get('blue-chips')
  async getBlueChips(@Query('limit') limit = 20): Promise<TVLScanResult> {
    const result = await this.tvlAnalyzerService.analyzeAllProtocols();
    return {
      ...result,
      blueChips: result.blueChips.slice(0, limit),
    };
  }

  @Get('multi-chain')
  async getMultiChain(@Query('limit') limit = 20): Promise<TVLScanResult> {
    const result = await this.tvlAnalyzerService.analyzeAllProtocols();
    return {
      ...result,
      multiChain: result.multiChain.slice(0, limit),
    };
  }

  @Get('protocol/:symbol')
  async getProtocolBySymbol(
    @Query('symbol') symbol: string,
  ): Promise<TVLAnalysisResult | null> {
    return this.tvlAnalyzerService.getProtocolBySymbol(symbol);
  }

  @Get('by-chain/:chain')
  async getByChain(
    @Query('chain') chain: string,
  ): Promise<TVLAnalysisResult[]> {
    return this.tvlAnalyzerService.getProtocolsByChain(chain);
  }

  @Get('by-category/:category')
  async getByCategory(
    @Query('category') category: string,
  ): Promise<TVLAnalysisResult[]> {
    return this.tvlAnalyzerService.getProtocolsByCategory(category);
  }
}
