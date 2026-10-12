import { Injectable, Logger } from '@nestjs/common';
import { TVLValidationDataService } from './tvl-validation-data.service';
import type {
  ProtocolValidationResult,
  ValidationScore,
  RiskFlags,
  TokenomicsData,
  TechnicalData,
  OnChainData,
  MarketStructureData,
  ValidationConfig,
} from './types/tvl-validation.types';
import type { TVLAnalysisResult } from '../tvl-analysis/types/tvl-analysis.types';

@Injectable()
export class TVLValidationAnalyzerService {
  private readonly logger = new Logger(TVLValidationAnalyzerService.name);

  private readonly DEFAULT_CONFIG: ValidationConfig = {
    minTvlScore: 60,
    minGrowth7d: 0,
    maxMcapTvlRatio: 2,
    minScoreForFull: 8,
    minScoreForHalf: 7,
    maxPositionFull: 2,
    maxPositionHalf: 1,
  };

  constructor(private readonly dataService: TVLValidationDataService) {}

  async validateProtocol(
    tvlResult: TVLAnalysisResult,
    config: Partial<ValidationConfig> = {},
  ): Promise<ProtocolValidationResult> {
    const cfg = { ...this.DEFAULT_CONFIG, ...config };
    const { protocol } = tvlResult;

    // Early filter
    if (tvlResult.tvlScore < cfg.minTvlScore) {
      return this.buildRejectionResult(tvlResult, 'TVL score below threshold');
    }
    if ((protocol.change_7d || 0) < cfg.minGrowth7d) {
      return this.buildRejectionResult(tvlResult, '7d growth below threshold');
    }
    if (
      tvlResult.mcapToTvlRatio !== null &&
      tvlResult.mcapToTvlRatio > cfg.maxMcapTvlRatio
    ) {
      return this.buildRejectionResult(tvlResult, 'Mcap/TVL ratio too high');
    }

    // Fetch all validation data in parallel
    const [tokenomics, technical, onChain, marketStructure] = await Promise.all(
      [
        this.dataService.fetchTokenomics(protocol.symbol, protocol.gecko_id),
        this.dataService.fetchTechnical(protocol.symbol),
        this.dataService.fetchOnChainData(
          protocol.slug,
          protocol.chain,
          protocol.category,
        ),
        this.dataService.fetchMarketStructure(protocol.symbol),
      ],
    );

    // Calculate risk flags
    const riskFlags = this.calculateRiskFlags(
      tvlResult,
      tokenomics,
      onChain,
      marketStructure,
    );

    // Calculate validation score
    const validationScore = this.calculateValidationScore(
      tvlResult,
      tokenomics,
      technical,
      onChain,
      marketStructure,
      cfg,
    );

    return {
      symbol: protocol.symbol,
      name: protocol.name,
      tvlAnalysis: {
        tvlScore: tvlResult.tvlScore,
        tvl: protocol.tvl,
        change7d: protocol.change_7d || 0,
        mcapToTvlRatio: tvlResult.mcapToTvlRatio,
      },
      tokenomics,
      technical,
      onChain,
      marketStructure,
      riskFlags,
      validationScore,
      timestamp: new Date().toISOString(),
    };
  }

  async validateMultiple(
    tvlResults: TVLAnalysisResult[],
    config: Partial<ValidationConfig> = {},
  ): Promise<ProtocolValidationResult[]> {
    const results = await Promise.all(
      tvlResults.map((r) => this.validateProtocol(r, config)),
    );
    return results.sort(
      (a, b) => b.validationScore.totalScore - a.validationScore.totalScore,
    );
  }

  private calculateRiskFlags(
    tvlResult: TVLAnalysisResult,
    tokenomics: TokenomicsData | null,
    onChain: OnChainData | null,
    marketStructure: MarketStructureData | null,
  ): RiskFlags {
    const flags: string[] = [];

    // TVL decline
    if ((tvlResult.protocol.change_7d || 0) < -20) {
      flags.push('TVL declined >20% in 7d');
    }

    // Overvalued Mcap/TVL
    if (tvlResult.mcapToTvlRatio !== null && tvlResult.mcapToTvlRatio > 3) {
      flags.push(
        `Mcap/TVL ratio: ${tvlResult.mcapToTvlRatio.toFixed(2)} (overvalued)`,
      );
    }

    // Large unlocks
    if (
      tokenomics?.upcomingUnlocks?.some(
        (u) => u.percentOfSupply > 5 && u.date < Date.now() + 30 * 86400000,
      )
    ) {
      flags.push('Large token unlock within 30 days');
    }

    // Low circulating supply
    if (tokenomics && tokenomics.circulatingPercent < 30) {
      flags.push(
        `Low circulating supply: ${tokenomics.circulatingPercent.toFixed(1)}%`,
      );
    }

    // High FDV/MC ratio
    if (tokenomics && tokenomics.fdvToMcapRatio > 5) {
      flags.push(
        `High FDV/Market Cap: ${tokenomics.fdvToMcapRatio.toFixed(1)}x`,
      );
    }

    // No revenue sharing
    if (tokenomics && !tokenomics.revenueShare) {
      flags.push('No revenue share to token holders');
    }

    // Low liquidity
    if (marketStructure && marketStructure.liquidityScore < 4) {
      flags.push('Low liquidity on exchanges');
    }

    // Negative funding + rising OI = short squeeze risk (not necessarily bad for longs but worth flagging)
    if (
      marketStructure &&
      marketStructure.fundingRate < -0.0005 &&
      marketStructure.oiTrend === 'UP'
    ) {
      flags.push('Negative funding with rising OI');
    }

    return {
      tvlDecline7d: (tvlResult.protocol.change_7d || 0) < -20,
      overvaluedMcapTvl: (tvlResult.mcapToTvlRatio || 0) > 3,
      largeUnlockSoon: flags.includes('Large token unlock within 30 days'),
      recentExploit: false, // would need exploit database
      regulatoryAction: false, // would need regulatory feed
      lowLiquidity: marketStructure
        ? marketStructure.liquidityScore < 4
        : false,
      flagCount: flags.length,
      flags,
    };
  }

  private calculateValidationScore(
    tvlResult: TVLAnalysisResult,
    tokenomics: TokenomicsData | null,
    technical: TechnicalData | null,
    onChain: OnChainData | null,
    marketStructure: MarketStructureData | null,
    cfg: ValidationConfig,
  ): ValidationScore {
    // 1. TVL Fundamental (25%)
    let tvlFundamental = Math.min(10, tvlResult.tvlScore / 10);
    if (tvlResult.protocol.change_7d && tvlResult.protocol.change_7d > 10)
      tvlFundamental += 1;
    if (tvlResult.protocol.change_7d && tvlResult.protocol.change_7d > 20)
      tvlFundamental += 1;
    tvlFundamental = Math.min(10, tvlFundamental);

    // 2. Tokenomics (20%)
    let tokenomicsScore = 5; // base
    if (tokenomics) {
      if (tokenomics.circulatingPercent > 70) tokenomicsScore += 2;
      else if (tokenomics.circulatingPercent > 50) tokenomicsScore += 1;
      else if (tokenomics.circulatingPercent < 30) tokenomicsScore -= 2;

      if (tokenomics.fdvToMcapRatio < 1.5) tokenomicsScore += 2;
      else if (tokenomics.fdvToMcapRatio < 3) tokenomicsScore += 1;
      else if (tokenomics.fdvToMcapRatio > 5) tokenomicsScore -= 2;

      if (tokenomics.revenueShare) tokenomicsScore += 2;
      if (tokenomics.upcomingUnlocks?.length === 0) tokenomicsScore += 1;
      else if (tokenomics.upcomingUnlocks?.some((u) => u.percentOfSupply > 10))
        tokenomicsScore -= 1;
    }
    tokenomicsScore = Math.max(0, Math.min(10, tokenomicsScore));

    // 3. Technical (20%)
    let technicalScore = 5;
    if (technical) {
      if (technical.trend === 'BULLISH') technicalScore += 2;
      else if (technical.trend === 'BEARISH') technicalScore -= 2;

      if (technical.priceVsEma50 > 0) technicalScore += 1;
      if (technical.priceVsEma200 > 0) technicalScore += 1;
      if (technical.rsi >= 40 && technical.rsi <= 60) technicalScore += 1;
      else if (technical.rsi > 70) technicalScore -= 1;
      else if (technical.rsi < 30) technicalScore -= 1;

      if (technical.volumeChange7d > 20) technicalScore += 1;
      if (technical.higherHighs && technical.higherLows) technicalScore += 1;
      technicalScore += Math.min(2, technical.structureScore / 5);
    }
    technicalScore = Math.max(0, Math.min(10, technicalScore));

    // 4. On-Chain (15%)
    let onChainScore = 5;
    if (onChain) {
      if (onChain.revenue30d > 1_000_000) onChainScore += 2;
      else if (onChain.revenue30d > 100_000) onChainScore += 1;

      if (onChain.tvlToRevenueRatio !== null) {
        if (onChain.tvlToRevenueRatio < 20)
          onChainScore += 2; // P/E < 20
        else if (onChain.tvlToRevenueRatio < 50) onChainScore += 1;
        else if (onChain.tvlToRevenueRatio > 100) onChainScore -= 1;
      }

      if (onChain.stablecoinTvlPercent > 50) onChainScore += 1;
      if (onChain.weeklyActiveUsers > 10000) onChainScore += 1;
    }
    onChainScore = Math.max(0, Math.min(10, onChainScore));

    // 5. Market Structure (10%)
    let marketStructureScore = 5;
    if (marketStructure) {
      if (marketStructure.hasTier1Listing) marketStructureScore += 2;
      if (marketStructure.liquidityScore >= 7) marketStructureScore += 1;
      else if (marketStructure.liquidityScore < 4) marketStructureScore -= 1;

      if (
        marketStructure.oiTrend === 'UP' &&
        marketStructure.fundingRate > -0.0002
      )
        marketStructureScore += 1;
      if (marketStructure.orderBookDepth2Percent > 1_000_000)
        marketStructureScore += 1;
    }
    marketStructureScore = Math.max(0, Math.min(10, marketStructureScore));

    // 6. Narrative (10%) - placeholder based on category
    const narrativeScores: Record<string, number> = {
      'Liquid Staking': 9,
      Lending: 8,
      Dexes: 7,
      CDP: 7,
      Bridge: 8,
      Yield: 6,
      Derivatives: 7,
      RWA: 9,
      AI: 8,
      DePIN: 8,
      Gaming: 5,
      NFT: 4,
    };
    const narrativeScore = narrativeScores[tvlResult.category] || 5;

    // Weighted total
    const totalScore =
      Math.round(
        (tvlFundamental * 0.25 +
          tokenomicsScore * 0.2 +
          technicalScore * 0.2 +
          onChainScore * 0.15 +
          marketStructureScore * 0.1 +
          narrativeScore * 0.1) *
          10,
      ) / 10;

    // Recommendation
    let recommendation: ValidationScore['recommendation'] = 'AVOID';
    let positionSizePercent = 0;

    if (totalScore >= cfg.minScoreForFull) {
      recommendation = 'FULL';
      positionSizePercent = cfg.maxPositionFull;
    } else if (totalScore >= cfg.minScoreForHalf) {
      recommendation = 'HALF';
      positionSizePercent = cfg.maxPositionHalf;
    } else if (totalScore >= 6) {
      recommendation = 'WATCH';
      positionSizePercent = 0;
    }

    // Reduce if too many risk flags
    const riskFlags = this.calculateRiskFlags(
      tvlResult,
      tokenomics,
      onChain,
      marketStructure,
    );
    if (riskFlags.flagCount >= 3) {
      if (recommendation === 'FULL') {
        recommendation = 'HALF';
        positionSizePercent = cfg.maxPositionHalf;
      } else if (recommendation === 'HALF') {
        recommendation = 'WATCH';
        positionSizePercent = 0;
      }
    }

    return {
      tvlFundamental: Math.round(tvlFundamental * 10) / 10,
      tokenomics: Math.round(tokenomicsScore * 10) / 10,
      technical: Math.round(technicalScore * 10) / 10,
      onChain: Math.round(onChainScore * 10) / 10,
      marketStructure: Math.round(marketStructureScore * 10) / 10,
      narrative: narrativeScore,
      totalScore,
      recommendation,
      positionSizePercent,
    };
  }

  private buildRejectionResult(
    tvlResult: TVLAnalysisResult,
    reason: string,
  ): ProtocolValidationResult {
    return {
      symbol: tvlResult.protocol.symbol,
      name: tvlResult.protocol.name,
      tvlAnalysis: {
        tvlScore: tvlResult.tvlScore,
        tvl: tvlResult.protocol.tvl,
        change7d: tvlResult.protocol.change_7d || 0,
        mcapToTvlRatio: tvlResult.mcapToTvlRatio,
      },
      tokenomics: null,
      technical: null,
      onChain: null,
      marketStructure: null,
      riskFlags: {
        tvlDecline7d: false,
        overvaluedMcapTvl: false,
        largeUnlockSoon: false,
        recentExploit: false,
        regulatoryAction: false,
        lowLiquidity: false,
        flagCount: 1,
        flags: [reason],
      },
      validationScore: {
        tvlFundamental: 0,
        tokenomics: 0,
        technical: 0,
        onChain: 0,
        marketStructure: 0,
        narrative: 0,
        totalScore: 0,
        recommendation: 'AVOID',
        positionSizePercent: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  getConfig(): ValidationConfig {
    return { ...this.DEFAULT_CONFIG };
  }

  updateConfig(config: Partial<ValidationConfig>): ValidationConfig {
    Object.assign(this.DEFAULT_CONFIG, config);
    return { ...this.DEFAULT_CONFIG };
  }
}
