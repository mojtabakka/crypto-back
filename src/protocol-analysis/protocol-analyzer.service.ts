import { Injectable, Logger } from '@nestjs/common';
import { ProtocolDataService } from './protocol-data.service';
import type {
  ProtocolDeepDive,
  ProtocolHealthScore,
  ProtocolActivityData,
  ProtocolValuation,
  ProtocolTvlData,
  ProtocolRevenueData,
  ProtocolTokenomics,
  ProtocolSecurity,
} from './types/protocol-analysis.types';

@Injectable()
export class ProtocolAnalyzerService {
  private readonly logger = new Logger(ProtocolAnalyzerService.name);

  constructor(private readonly dataService: ProtocolDataService) {}

  async analyze(slug: string): Promise<ProtocolDeepDive | null> {
    const detail = await this.dataService.fetchProtocolDetail(slug);
    if (!detail) return null;

    const index = await this.dataService.getProtocolIndex().catch(() => []);
    const indexEntry = index.find((p) => p.slug === (detail.slug ?? slug));

    const tvl = this.dataService.buildTvlData(
      detail,
      indexEntry ? [indexEntry] : undefined,
    );

    // Pull stablecoin liquidity for the chains that actually hold the TVL,
    // otherwise the share-of-chain-float ratio is meaningless.
    const topChains = tvl.chainBreakdown.slice(0, 2).map((c) => c.chain);
    const stablecoinSupplies = await Promise.all(
      topChains.map((chain) =>
        this.dataService
          .fetchChainStablecoinSupply(chain)
          .then((value) => ({ chain, value })),
      ),
    );

    const [fees, revenue, volume, coin] = await Promise.all([
      this.dataService.fetchFees(detail.slug ?? slug),
      this.dataService.fetchRevenue(detail.slug ?? slug),
      this.dataService.fetchVolume(detail.slug ?? slug),
      detail.gecko_id ? this.dataService.fetchCoinGecko(detail.gecko_id) : null,
    ]);

    const revenueData = this.dataService.buildRevenueData(
      fees,
      revenue,
      volume,
    );
    const tokenomics = this.dataService.buildTokenomics(
      detail,
      coin,
      indexEntry,
    );
    const security = this.dataService.buildSecurity(detail, fees);

    const activity = this.buildActivity(tvl, revenueData, stablecoinSupplies);
    const valuation = this.buildValuation(tvl, revenueData, tokenomics);
    const warnings = this.buildWarnings(tvl, revenueData, tokenomics, security);
    const healthScore = this.buildHealthScore(
      tvl,
      revenueData,
      activity,
      valuation,
      security,
      tokenomics,
    );

    // Parent entries on DefiLlama (Aave, Uniswap) leave category/chains/logo
    // empty on the detail endpoint, so backfill from the aggregated index entry.
    const fallbackChains = detail.chains?.length
      ? detail.chains
      : (indexEntry?.chains ?? []);
    const fallbackName =
      detail.name || indexEntry?.name || (detail.slug ?? slug);

    return {
      identity: {
        slug: detail.slug ?? slug,
        name: fallbackName,
        symbol:
          detail.symbol ||
          indexEntry?.symbol ||
          fallbackName.slice(0, 6).toUpperCase(),
        logo: detail.logo || indexEntry?.logo || '',
        description: detail.description ?? '',
        url: detail.url ?? '',
        twitter: detail.twitter ?? null,
        category: detail.category || indexEntry?.category || 'Other',
        chains: fallbackChains,
        listedAt: detail.listedAt,
        ageInDays: detail.listedAt
          ? Math.floor((Date.now() / 1000 - detail.listedAt) / 86400)
          : 0,
        geckoId: detail.gecko_id ?? null,
        methodology: detail.methodology ?? null,
      },
      tvl,
      revenue: revenueData,
      activity,
      tokenomics,
      security,
      valuation,
      healthScore,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }

  private buildActivity(
    tvl: ProtocolTvlData,
    revenue: ProtocolRevenueData,
    stablecoinSupplies: { chain: string; value: number | null }[],
  ): ProtocolActivityData {
    const dominantChain = tvl.chainBreakdown[0] ?? null;
    const dominantSupply = dominantChain
      ? (stablecoinSupplies.find((s) => s.chain === dominantChain.chain)
          ?.value ?? null)
      : null;
    const stablecoinSharePercent =
      dominantSupply && dominantSupply > 0 && tvl.total > 0
        ? (tvl.total / dominantSupply) * 100
        : null;

    const feesToTvlPercent =
      revenue.fees30d && tvl.total > 0
        ? (revenue.fees30d / tvl.total) * 100
        : null;

    const volumeToTvlPercent =
      revenue.volume30d && tvl.total > 0
        ? (revenue.volume30d / tvl.total) * 100
        : null;

    const revenueMultiple =
      tvl.total &&
      revenue.annualizedRevenue30d &&
      revenue.annualizedRevenue30d > 0
        ? tvl.total / revenue.annualizedRevenue30d
        : null;

    let activityScore = 0;
    if (feesToTvlPercent !== null) {
      if (feesToTvlPercent > 3) activityScore += 30;
      else if (feesToTvlPercent > 1.5) activityScore += 22;
      else if (feesToTvlPercent > 0.7) activityScore += 15;
      else if (feesToTvlPercent > 0.2) activityScore += 8;
    }
    if (volumeToTvlPercent !== null && volumeToTvlPercent > 50)
      activityScore += 20;
    if (tvl.chainBreakdown.length >= 3) activityScore += 15;
    if (revenue.fees7d && revenue.fees7d > 100_000) activityScore += 20;
    else if (revenue.fees7d && revenue.fees7d > 10_000) activityScore += 12;
    if (stablecoinSharePercent !== null && stablecoinSharePercent < 30)
      activityScore += 15;

    return {
      stablecoinSupplyUsd: dominantSupply ?? null,
      stablecoinSharePercent,
      dominantChain: dominantChain?.chain ?? null,
      feesToTvlPercent,
      volumeToTvlPercent,
      revenueMultiple,
      chainsCount: tvl.chainBreakdown.length,
      topChainSharePercent: dominantChain?.sharePercent ?? null,
      activityScore: Math.max(0, Math.min(100, activityScore)),
    };
  }

  private buildValuation(
    tvl: ProtocolTvlData,
    revenue: ProtocolRevenueData,
    tokenomics: ProtocolTokenomics,
  ): ProtocolValuation {
    const labels: ProtocolValuation['labels'] = [];

    const mcapToTvl = tvl.mcapToTvl;
    if (mcapToTvl !== null) {
      labels.push({
        label: 'Mcap / TVL',
        value: mcapToTvl.toFixed(2),
        tone: mcapToTvl < 1 ? 'GOOD' : mcapToTvl > 3 ? 'BAD' : 'NEUTRAL',
      });
    }

    if (revenue.annualizedRevenue30d && tvl.total > 0) {
      const pe = tvl.total / revenue.annualizedRevenue30d;
      labels.push({
        label: 'TVL / Revenue (ann.)',
        value: pe.toFixed(1),
        tone: pe < 30 ? 'GOOD' : pe > 100 ? 'BAD' : 'NEUTRAL',
      });
    }

    if (tokenomics.marketCap && revenue.fees1y) {
      const feesToMcap = (revenue.fees1y / tokenomics.marketCap) * 100;
      labels.push({
        label: 'Fees(1y) / Mcap',
        value: `${feesToMcap.toFixed(2)}%`,
        tone: feesToMcap > 5 ? 'GOOD' : feesToMcap > 1 ? 'NEUTRAL' : 'BAD',
      });
    }

    if (tokenomics.fdvToMcap !== null) {
      labels.push({
        label: 'FDV / Mcap',
        value: `${tokenomics.fdvToMcap.toFixed(2)}x`,
        tone:
          tokenomics.fdvToMcap < 2
            ? 'GOOD'
            : tokenomics.fdvToMcap > 5
              ? 'BAD'
              : 'NEUTRAL',
      });
    }

    return {
      mcapToTvl,
      tvlToRevenueAnnualized:
        revenue.annualizedRevenue30d && tvl.total > 0
          ? tvl.total / revenue.annualizedRevenue30d
          : null,
      feesToMcap:
        tokenomics.marketCap && revenue.fees1y
          ? (revenue.fees1y / tokenomics.marketCap) * 100
          : null,
      labels,
    };
  }

  private buildWarnings(
    tvl: ProtocolTvlData,
    revenue: ProtocolRevenueData,
    tokenomics: ProtocolTokenomics,
    security: ProtocolSecurity,
  ): string[] {
    const warnings: string[] = [];

    if (tvl.change7d !== null && tvl.change7d < -20) {
      warnings.push(
        `TVL dropped ${Math.abs(tvl.change7d).toFixed(1)}% in the last 7 days`,
      );
    }
    if (tvl.mcapToTvl !== null && tvl.mcapToTvl > 3) {
      warnings.push(
        `Market cap is ${tvl.mcapToTvl.toFixed(1)}x TVL - valuation looks stretched`,
      );
    }
    if (tvl.total < 10_000_000) {
      warnings.push('TVL below $10M - high liquidity/slippage risk');
    }
    if (revenue.fees30d === null || revenue.fees30d === 0) {
      warnings.push('No fee revenue reported - cannot value on fundamentals');
    }
    if (revenue.revenue30d === null && revenue.fees30d) {
      warnings.push(
        'Protocol does not report token-holder revenue - fees may not accrue to the token',
      );
    }
    if (
      tokenomics.circulatingPercent !== null &&
      tokenomics.circulatingPercent < 30
    ) {
      warnings.push(
        `Only ${tokenomics.circulatingPercent.toFixed(1)}% of supply circulating - unlock risk`,
      );
    }
    if (tokenomics.fdvToMcap !== null && tokenomics.fdvToMcap > 5) {
      warnings.push(
        `FDV is ${tokenomics.fdvToMcap.toFixed(1)}x market cap - heavy future dilution`,
      );
    }
    if (security.hasHackHistory) {
      warnings.push(
        `Security incident: $${Math.round(security.hackLossUsd).toLocaleString()} lost (${security.hackLossToTvlPercent.toFixed(3)}% of TVL)`,
      );
    } else if (security.hacks && security.hacks.length > 0) {
      warnings.push(
        `Historical minor incidents ($${Math.round(security.hackLossUsd).toLocaleString()} total) - not material to current TVL`,
      );
    }
    if (!security.isAudited) {
      // Large, long-lived protocols missing audit metadata is usually a DefiLlama
      // data gap rather than an actual finding, so only surface it for smaller TVL.
      if (tvl.total < 500_000_000) {
        warnings.push('No public audit information found');
      } else {
        warnings.push(
          'Audit metadata missing from DefiLlama - verify audit status independently',
        );
      }
    }
    if (
      tvl.chainBreakdown.length > 0 &&
      tvl.chainBreakdown[0].chain === 'Ethereum' &&
      tvl.chainBreakdown[0].sharePercent > 85
    ) {
      warnings.push(
        `${tvl.chainBreakdown[0].sharePercent.toFixed(0)}% of TVL on Ethereum - single-chain dependency`,
      );
    }

    return warnings;
  }

  private buildHealthScore(
    tvl: ProtocolTvlData,
    revenue: ProtocolRevenueData,
    activity: ProtocolActivityData,
    valuation: ProtocolValuation,
    security: ProtocolSecurity,
    tokenomics: ProtocolTokenomics,
  ): ProtocolHealthScore {
    // TVL strength (0-100)
    let tvlStrength = 0;
    if (tvl.total >= 1_000_000_000) tvlStrength = 100;
    else if (tvl.total >= 500_000_000) tvlStrength = 88;
    else if (tvl.total >= 100_000_000) tvlStrength = 75;
    else if (tvl.total >= 50_000_000) tvlStrength = 62;
    else if (tvl.total >= 10_000_000) tvlStrength = 45;
    else if (tvl.total >= 1_000_000) tvlStrength = 25;
    else tvlStrength = 10;

    // Growth (0-100)
    const growth30 = tvl.change1m ?? 0;
    const growth7 = tvl.change7d ?? 0;
    let growth = 50;
    growth += Math.max(-40, Math.min(40, growth30 * 1.5));
    growth += Math.max(-20, Math.min(20, growth7 * 0.8));
    if (revenue.feesChange7d !== null) {
      growth += Math.max(-15, Math.min(15, revenue.feesChange7d * 0.5));
    }
    growth = Math.max(0, Math.min(100, growth));

    // Revenue quality (0-100)
    let revenueQuality = 0;
    const annRevenue =
      revenue.annualizedRevenue30d ?? revenue.annualizedFees30d ?? 0;
    if (annRevenue >= 100_000_000) revenueQuality = 100;
    else if (annRevenue >= 25_000_000) revenueQuality = 85;
    else if (annRevenue >= 5_000_000) revenueQuality = 70;
    else if (annRevenue >= 1_000_000) revenueQuality = 55;
    else if (annRevenue >= 100_000) revenueQuality = 35;
    else if (annRevenue > 0) revenueQuality = 18;
    if (activity.revenueMultiple !== null) {
      if (activity.revenueMultiple < 30) revenueQuality += 10;
      else if (activity.revenueMultiple > 100) revenueQuality -= 15;
    }
    revenueQuality = Math.max(0, Math.min(100, revenueQuality));

    // Valuation (0-100) - higher = cheaper/better
    let valuationScore = 50;
    if (valuation.mcapToTvl !== null) {
      if (valuation.mcapToTvl < 0.5) valuationScore += 30;
      else if (valuation.mcapToTvl < 1) valuationScore += 22;
      else if (valuation.mcapToTvl < 2) valuationScore += 12;
      else if (valuation.mcapToTvl > 4) valuationScore -= 25;
      else if (valuation.mcapToTvl > 3) valuationScore -= 12;
    }
    if (valuation.feesToMcap !== null) {
      if (valuation.feesToMcap > 5) valuationScore += 18;
      else if (valuation.feesToMcap > 2) valuationScore += 10;
      else if (valuation.feesToMcap < 0.5) valuationScore -= 15;
    }
    valuationScore = Math.max(0, Math.min(100, valuationScore));

    // Tokenomics (0-100)
    let tokenomicsScore = 60;
    if (tokenomics.circulatingPercent !== null) {
      if (tokenomics.circulatingPercent > 70) tokenomicsScore += 25;
      else if (tokenomics.circulatingPercent > 50) tokenomicsScore += 12;
      else if (tokenomics.circulatingPercent < 30) tokenomicsScore -= 25;
    }
    if (tokenomics.fdvToMcap !== null) {
      if (tokenomics.fdvToMcap < 1.5) tokenomicsScore += 15;
      else if (tokenomics.fdvToMcap > 5) tokenomicsScore -= 20;
    }
    if (
      tokenomics.athChangePercent !== null &&
      tokenomics.athChangePercent > -40
    ) {
      tokenomicsScore += 10;
    }
    tokenomicsScore = Math.max(0, Math.min(100, tokenomicsScore));

    const total = Math.round(
      tvlStrength * 0.25 +
        growth * 0.15 +
        revenueQuality * 0.25 +
        activity.activityScore * 0.15 +
        valuationScore * 0.1 +
        security.securityScore * 0.05 +
        tokenomicsScore * 0.05,
    );

    let verdict: ProtocolHealthScore['verdict'];
    let summary: string;

    const capitalFlight = tvl.change7d !== null && tvl.change7d < -25;
    if (security.hasHackHistory || capitalFlight) {
      verdict = 'AVOID';
      summary = security.hasHackHistory
        ? 'Recent or material security incident - wait for post-incident recovery'
        : 'Sharp TVL outflow over the past week - capital leaving the protocol';
    } else if (total >= 78 && revenueQuality >= 60) {
      verdict = 'STRONG_BUY';
      summary =
        'Large TVL with real revenue generation and attractive valuation';
    } else if (total >= 66) {
      verdict = 'ACCUMULATE';
      summary = 'Solid fundamentals with healthy growth and usage metrics';
    } else if (total >= 52) {
      verdict = 'HOLD';
      summary =
        'Mixed signals - acceptable but not compelling at current valuation';
    } else if (total >= 38) {
      verdict = 'CAUTION';
      summary =
        'Weak fundamentals - thin liquidity, low revenue or poor tokenomics';
    } else {
      verdict = 'AVOID';
      summary = 'Insufficient data or fundamental weakness';
    }

    return {
      total,
      tvlStrength: Math.round(tvlStrength),
      growth: Math.round(growth),
      revenueQuality: Math.round(revenueQuality),
      activity: Math.round(activity.activityScore),
      valuation: Math.round(valuationScore),
      security: Math.round(security.securityScore),
      tokenomics: Math.round(tokenomicsScore),
      verdict,
      summary,
    };
  }
}
