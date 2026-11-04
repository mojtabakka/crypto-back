import { Injectable, Logger } from '@nestjs/common';
import { TVLService } from './tvl.service';
import type {
  TVLAnalysisResult,
  TVLScanResult,
  DefiLlamaProtocol,
} from './types/tvl-analysis.types';

@Injectable()
export class TVLAnalyzerService {
  private readonly logger = new Logger(TVLAnalyzerService.name);

  constructor(private readonly tvlService: TVLService) {}

  async analyzeAllProtocols(): Promise<TVLScanResult> {
    this.logger.log('Starting TVL analysis for all protocols...');
    const startTime = Date.now();

    const protocols = await this.tvlService.fetchAllProtocols();
    const analyzed: TVLAnalysisResult[] = [];

    for (const protocol of protocols) {
      const analysis = this.analyzeProtocol(protocol);
      analyzed.push(analysis);
    }

    // Sort by TVL score
    analyzed.sort((a, b) => b.tvlScore - a.tvlScore);

    // Categorize results
    const topByTVL = analyzed
      .sort((a, b) => b.protocol.tvl - a.protocol.tvl)
      .slice(0, 20);

    const topByGrowth = analyzed
      .filter((a) => (a.protocol.change_7d || 0) > 0)
      .sort((a, b) => (b.protocol.change_7d || 0) - (a.protocol.change_7d || 0))
      .slice(0, 20);

    const undervalued = analyzed
      .filter((a) => {
        const ratio = a.mcapToTvlRatio;
        return (
          ratio !== null &&
          ratio < 1 &&
          a.protocol.mcap &&
          a.protocol.mcap > 50_000_000 &&
          a.protocol.tvl > 50_000_000
        );
      })
      .sort((a, b) => (a.mcapToTvlRatio || 999) - (b.mcapToTvlRatio || 999))
      .slice(0, 20);

    const blueChips = analyzed
      .filter((a) => a.signals.some((s) => s.type === 'BLUE_CHIP'))
      .slice(0, 20);

    const multiChain = analyzed
      .filter((a) => a.protocol.chains.length >= 5)
      .sort((a, b) => b.protocol.chains.length - a.protocol.chains.length)
      .slice(0, 20);

    const duration = Date.now() - startTime;
    this.logger.log(
      `TVL analysis complete: ${analyzed.length} protocols in ${duration}ms`,
    );

    return {
      totalProtocols: protocols.length,
      analyzed: analyzed.length,
      allAnalyzed: analyzed,
      topByTVL,
      topByGrowth,
      undervalued,
      blueChips,
      multiChain,
      timestamp: new Date().toISOString(),
    };
  }

  analyzeProtocol(protocol: DefiLlamaProtocol): TVLAnalysisResult {
    const tvlScore = this.tvlService.calculateTVLScore(protocol);
    const mcapToTvlRatio = this.tvlService.calculateMcapToTvlRatio(protocol);
    const signals = this.tvlService.generateSignals(protocol);

    return {
      protocol,
      tvlScore,
      mcapToTvlRatio,
      category: protocol.category,
      chain: protocol.chain,
      signals,
    };
  }

  async getTopOpportunities(limit = 10): Promise<TVLAnalysisResult[]> {
    const result = await this.analyzeAllProtocols();

    // Combine signals with weighting
    const scored = result.allAnalyzed
      .map((a) => ({
        ...a,
        _opportunityScore: this.calculateOpportunityScore(a),
      }))
      .sort((a, b) => b._opportunityScore - a._opportunityScore);

    return scored.slice(0, limit).map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _opportunityScore, ...rest } = item;
      return rest;
    });
  }

  private calculateOpportunityScore(analysis: TVLAnalysisResult): number {
    let score = analysis.tvlScore * 0.4; // Base TVL quality

    // Boost for growth
    const growth = analysis.protocol.change_7d || 0;
    if (growth > 0) score += Math.min(growth * 0.5, 20);

    // Boost for low mcap/tvl (undervalued)
    if (analysis.mcapToTvlRatio !== null && analysis.mcapToTvlRatio < 1) {
      score += (1 - analysis.mcapToTvlRatio) * 30;
    }

    // Boost for strong signals
    const strongSignals = analysis.signals.filter(
      (s) => s.strength === 'STRONG',
    ).length;
    score += strongSignals * 5;

    // Boost for multi-chain
    if (analysis.protocol.chains.length >= 5) score += 10;

    return Math.min(100, score);
  }

  async getProtocolBySymbol(symbol: string): Promise<TVLAnalysisResult | null> {
    const protocols = await this.tvlService.fetchAllProtocols();
    const protocol = protocols.find(
      (p) => p.symbol.toLowerCase() === symbol.toLowerCase(),
    );

    if (!protocol) return null;
    return this.analyzeProtocol(protocol);
  }

  async getProtocolsByChain(chain: string): Promise<TVLAnalysisResult[]> {
    const protocols = await this.tvlService.fetchProtocolsByChain(chain);
    return protocols
      .map((p) => this.analyzeProtocol(p))
      .sort((a, b) => b.tvlScore - a.tvlScore);
  }

  async getProtocolsByCategory(category: string): Promise<TVLAnalysisResult[]> {
    const protocols = await this.tvlService.fetchProtocolsByCategory(category);
    return protocols
      .map((p) => this.analyzeProtocol(p))
      .sort((a, b) => b.tvlScore - a.tvlScore);
  }
}
