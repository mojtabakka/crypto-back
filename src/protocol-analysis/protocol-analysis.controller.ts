import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProtocolAnalyzerService } from './protocol-analyzer.service';
import { ProtocolDataService } from './protocol-data.service';
import type {
  ProtocolSearchItem,
  ProtocolDeepDive,
} from './types/protocol-analysis.types';

@Controller('protocol-analysis')
export class ProtocolAnalysisController {
  constructor(
    private readonly analyzerService: ProtocolAnalyzerService,
    private readonly dataService: ProtocolDataService,
  ) {}

  @Get('search')
  async search(
    @Query('query') query = '',
    @Query('limit') limit = 30,
  ): Promise<ProtocolSearchItem[]> {
    return this.dataService.searchProtocols(
      query,
      Math.min(Number(limit) || 30, 100),
    );
  }

  @Get('categories')
  async categories(): Promise<
    { category: string; count: number; totalTvl: number }[]
  > {
    const index = await this.dataService.getProtocolIndex();
    const map = new Map<
      string,
      { category: string; count: number; totalTvl: number }
    >();

    for (const protocol of index) {
      const existing = map.get(protocol.category) ?? {
        category: protocol.category,
        count: 0,
        totalTvl: 0,
      };
      existing.count += 1;
      existing.totalTvl += protocol.tvl;
      map.set(protocol.category, existing);
    }

    return [...map.values()].sort((a, b) => b.totalTvl - a.totalTvl);
  }

  @Get(':slug')
  async analyze(
    @Param('slug') slug: string,
  ): Promise<ProtocolDeepDive | { error: string }> {
    const report = await this.analyzerService.analyze(slug);
    if (!report) return { error: `Protocol "${slug}" not found` };
    return report;
  }
}
