import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { FuturesTicker, MarketDataService } from 'src/analytics/market-data.service';
import { TVLAnalysisResult, TVLProtocol, TVLSignal } from 'src/types/tvl-analysis';
import {
  ProtocolDeepDive,
  ProtocolSearchItem,
  ProtocolTokenomics,
} from 'src/types/protocol-analysis';
import {
  LongSqueezeAssessment,
  VolumeMarketCapMatch,
  VolumeMarketCapScanResult,
} from 'src/types/volume-marketcap';

const LLAMA = 'https://api.llama.fi';
const COINGECKO = 'https://api.coingecko.com/api/v3';

interface LlamaProtocol {
  id?: string | number;
  slug?: string;
  parentProtocol?: string;
  parentProtocolSlug?: string;
  chainTvls?: Record<string, number>;
  name?: string;
  symbol?: string;
  url?: string;
  description?: string;
  chain?: string;
  logo?: string;
  category?: string;
  chains?: string[];
  tvl?: number;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
  fdv?: number;
  gecko_id?: string | null;
  listedAt?: number;
  methodology?: string;
  audits?: string | number | null;
  audit_links?: string | string[] | null;
  hacks?: unknown;
  oracles?: unknown;
  twitter?: string | null;
  auditsNote?: string;
}

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  market_cap_rank: number | null;
  price_change_percentage_24h: number | null;
  circulating_supply: number | null;
}

interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
  market_data?: {
    current_price?: Record<string, number>;
    market_cap?: Record<string, number>;
    fully_diluted_valuation?: Record<string, number>;
    total_volume?: Record<string, number>;
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
    ath?: Record<string, number>;
    ath_change_percentage?: Record<string, number>;
    price_change_percentage_24h?: number;
    price_change_percentage_7d?: number;
    price_change_percentage_30d?: number;
    price_change_percentage_1y?: number;
  };
  detail_platforms?: Record<string, { decimal_place?: number }>;
}

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

/** `Aave V3` / `aave-v3` / `AaveV3` all collapse to `aavev3`. */
const normalizeKey = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * DeFi fundamentals: TVL screening, protocol deep dives and
 * volume/market-cap ratio screening.
 *
 * Upstream data is cached aggressively (DefiLlama /protocols is ~2MB), so the
 * seven TVL tabs all resolve from a single fetch.
 */
@Injectable()
export class IntelService {
  private readonly logger = new Logger(IntelService.name);

  private protocolsCache?: { at: number; data: LlamaProtocol[] };
  private analysedCache?: { at: number; data: TVLAnalysisResult[] };
  private readonly geckoCache = new Map<string, { at: number; data: CoinGeckoMarket[] }>();
  private readonly coinCache = new Map<string, { at: number; data: CoinGeckoCoin | null }>();
  private feesCache?: { at: number; data: Array<Record<string, unknown>> };

  private readonly TTL = 5 * 60_000;
  private readonly CG_TTL = 2 * 60_000;

  constructor(private readonly marketData: MarketDataService) {}

  private async fetchJson<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await axios.get<T>(url, { params, timeout: 20_000 });
    return response.data;
  }

  // ==================================================================
  // Protocol universe
  // ==================================================================

  private async getProtocols(): Promise<LlamaProtocol[]> {
    if (this.protocolsCache && Date.now() - this.protocolsCache.at < this.TTL) {
      return this.protocolsCache.data;
    }

    const raw = await this.fetchJson<LlamaProtocol[]>(`${LLAMA}/protocols`);
    const data = (Array.isArray(raw) ? raw : [])
      .filter((p) => num(p.tvl) > 0)
      .sort((a, b) => num(b.tvl) - num(a.tvl));

    this.protocolsCache = { at: Date.now(), data };
    this.logger.log(`Loaded ${data.length} protocols from DefiLlama`);
    return data;
  }

  private toProtocol(p: LlamaProtocol): TVLProtocol {
    return {
      id: String(p.id ?? p.name ?? ''),
      name: p.name ?? 'Unknown',
      symbol: (p.symbol ?? '').toUpperCase(),
      url: p.url ?? '',
      description: p.description ?? '',
      chain: p.chain ?? 'Multi-Chain',
      logo: p.logo ?? '',
      category: p.category ?? 'Uncategorized',
      chains: Array.isArray(p.chains) ? p.chains : [p.chain ?? 'Multi-Chain'],
      tvl: num(p.tvl),
      change_1h: num(p.change_1h),
      change_1d: num(p.change_1d),
      change_7d: num(p.change_7d),
      chainTvls: {},
      mcap: nullableNum(p.mcap) ?? undefined,
      fdv: nullableNum(p.fdv) ?? undefined,
      mcapRank: undefined,
      listedAt: num(p.listedAt),
    };
  }

  private analyse(protocol: LlamaProtocol): TVLAnalysisResult {
    const modeled = this.toProtocol(protocol);
    const signals: TVLSignal[] = [];

    let score = clamp(Math.log10(Math.max(modeled.tvl, 1)) * 6, 0, 55);

    if (modeled.tvl >= 1e9) {
      signals.push({
        type: 'HIGH_TVL',
        strength: 'STRONG',
        description: `$${(modeled.tvl / 1e9).toFixed(1)}B TVL — top-tier depth`,
      });
    } else if (modeled.tvl >= 1e8) {
      signals.push({
        type: 'HIGH_TVL',
        strength: 'MODERATE',
        description: `$${(modeled.tvl / 1e6).toFixed(0)}M TVL — established depth`,
      });
    }

    if (modeled.change_7d >= 10) {
      score += Math.min(25, modeled.change_7d * 0.6);
      signals.push({
        type: 'GROWING_TVL',
        strength: modeled.change_7d >= 25 ? 'STRONG' : 'MODERATE',
        description: `TVL up ${modeled.change_7d.toFixed(1)}% over 7 days`,
      });
    } else if (Math.abs(modeled.change_7d) <= 3) {
      score += 6;
      signals.push({
        type: 'STABLE_TVL',
        strength: 'MODERATE',
        description: `TVL stable (${modeled.change_7d.toFixed(1)}% 7d)`,
      });
    }

    const mcapToTvlRatio =
      modeled.mcap && modeled.mcap > 0 ? modeled.mcap / modeled.tvl : null;

    if (mcapToTvlRatio !== null && mcapToTvlRatio < 1 && modeled.tvl >= 5e6) {
      score += Math.min(15, (1 - mcapToTvlRatio) * 15);
      signals.push({
        type: 'LOW_MCAP_TVL_RATIO',
        strength: mcapToTvlRatio < 0.3 ? 'STRONG' : 'MODERATE',
        description: `MCap/TVL ${mcapToTvlRatio.toFixed(2)} — fees are cheap vs locked value`,
      });
    }

    if (modeled.chains.length >= 3) {
      score += 8;
      signals.push({
        type: 'MULTI_CHAIN',
        strength: modeled.chains.length >= 6 ? 'STRONG' : 'MODERATE',
        description: `Live on ${modeled.chains.length} chains`,
      });
    }

    const ageYears =
      modeled.listedAt > 0
        ? (Date.now() / 1000 - modeled.listedAt) / (365 * 24 * 3600)
        : 0;

    if (modeled.tvl >= 1e9 && ageYears >= 2 && signals.length >= 2) {
      score += 10;
      signals.push({
        type: 'BLUE_CHIP',
        strength: 'STRONG',
        description: `Blue chip: ${ageYears.toFixed(1)}y live with $${(modeled.tvl / 1e9).toFixed(1)}B locked`,
      });
    }

    return {
      protocol: modeled,
      tvlScore: Number(clamp(score).toFixed(1)),
      mcapToTvlRatio:
        mcapToTvlRatio === null ? null : Number(mcapToTvlRatio.toFixed(3)),
      category: modeled.category,
      chain: modeled.chain,
      signals,
    };
  }

  private async getAnalysed(): Promise<TVLAnalysisResult[]> {
    if (this.analysedCache && Date.now() - this.analysedCache.at < this.TTL) {
      return this.analysedCache.data;
    }

    const protocols = await this.getProtocols();
    const data = protocols.slice(0, 400).map((p) => this.analyse(p));

    this.analysedCache = { at: Date.now(), data };
    return data;
  }

  // ==================================================================
  // TVL endpoints
  // ==================================================================

  async getScan(limit = 20): Promise<{
    totalProtocols: number;
    analyzed: number;
    allAnalyzed: TVLAnalysisResult[];
    topByTVL: TVLAnalysisResult[];
    topByGrowth: TVLAnalysisResult[];
    undervalued: TVLAnalysisResult[];
    blueChips: TVLAnalysisResult[];
    multiChain: TVLAnalysisResult[];
    timestamp: string;
  }> {
    const analysed = await this.getAnalysed();
    const total = (await this.getProtocols()).length;

    const topByTVL = [...analysed]
      .sort((a, b) => b.protocol.tvl - a.protocol.tvl)
      .slice(0, limit);

    const topByGrowth = analysed
      .filter((a) => a.protocol.tvl >= 1e6)
      .sort((a, b) => b.protocol.change_7d - a.protocol.change_7d)
      .slice(0, limit);

    const undervalued = analysed
      .filter(
        (a) =>
          a.mcapToTvlRatio !== null &&
          a.mcapToTvlRatio > 0 &&
          a.mcapToTvlRatio < 1 &&
          a.protocol.tvl >= 5e6,
      )
      .sort((a, b) => (a.mcapToTvlRatio ?? 1) - (b.mcapToTvlRatio ?? 1))
      .slice(0, limit);

    const blueChips = analysed
      .filter((a) => a.protocol.tvl >= 1e9)
      .slice(0, limit);

    const multiChain = analysed
      .filter((a) => a.protocol.chains.length >= 3)
      .slice(0, limit);

    const opportunities = [...analysed]
      .sort((a, b) => b.tvlScore - a.tvlScore)
      .slice(0, limit);

    return {
      totalProtocols: total,
      analyzed: analysed.length,
      allAnalyzed: opportunities,
      topByTVL,
      topByGrowth,
      undervalued,
      blueChips,
      multiChain,
      timestamp: new Date().toISOString(),
    };
  }

  async getTopByTvl(limit = 20) {
    return this.getScan(limit);
  }

  async getTopByGrowth(limit = 20) {
    return this.getScan(limit);
  }

  async getUndervalued(limit = 20) {
    return this.getScan(limit);
  }

  async getBlueChips(limit = 20) {
    return this.getScan(limit);
  }

  async getMultiChain(limit = 20) {
    return this.getScan(limit);
  }

  async getTopOpportunities(limit = 20): Promise<TVLAnalysisResult[]> {
    const analysed = await this.getAnalysed();
    return [...analysed]
      .sort((a, b) => b.tvlScore - a.tvlScore)
      .slice(0, limit);
  }

  async getByChain(chain: string, limit = 50): Promise<TVLAnalysisResult[]> {
    const needle = chain.toLowerCase();
    const analysed = await this.getAnalysed();
    return analysed
      .filter(
        (a) =>
          a.protocol.chain.toLowerCase() === needle ||
          a.protocol.chains.some((c) => c.toLowerCase() === needle),
      )
      .slice(0, limit);
  }

  async getByCategory(category: string, limit = 50): Promise<TVLAnalysisResult[]> {
    const needle = category.toLowerCase();
    const analysed = await this.getAnalysed();
    return analysed
      .filter((a) => a.protocol.category.toLowerCase() === needle)
      .slice(0, limit);
  }

  async getProtocolBySymbol(symbol: string): Promise<TVLAnalysisResult> {
    const needle = symbol.toLowerCase();
    const protocols = await this.getProtocols();

    const match = protocols.find(
      (p) =>
        (p.symbol ?? '').toLowerCase() === needle ||
        String(p.id ?? '').toLowerCase() === needle ||
        (p.name ?? '').toLowerCase() === needle,
    );

    if (!match) {
      throw new NotFoundException(`No protocol found for "${symbol}"`);
    }

    const result = this.analyse(match);
    result.protocol.chainTvls = await this.getChainBreakdown(match);
    return result;
  }

  private async getChainBreakdown(protocol: LlamaProtocol): Promise<Record<string, number>> {
    // DefiLlama's detail endpoint is slug-based (`aave-v3`); numeric ids and
    // `parent#...` ids now answer 400.
    for (const candidate of this.detailCandidates(protocol)) {
      try {
        const detail = await this.fetchJson<{ currentChainTvls?: Record<string, number> }>(
          `${LLAMA}/protocol/${encodeURIComponent(candidate)}`,
        );

        const breakdown: Record<string, number> = {};
        for (const [chain, tvl] of Object.entries(detail.currentChainTvls ?? {})) {
          if (chain.includes('-') || ['borrowed', 'staking', 'pool2'].includes(chain)) {
            continue;
          }
          if (num(tvl) > 0) breakdown[chain] = num(tvl);
        }
        return breakdown;
      } catch {
        // next candidate
      }
    }

    return {};
  }

  /** Slug-ish values that DefiLlama's `/protocol/:key` endpoint accepts. */
  private detailCandidates(protocol: LlamaProtocol): string[] {
    const kebab = String(protocol.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return [protocol.slug, protocol.parentProtocolSlug, kebab, String(protocol.id ?? '')]
      .filter((candidate): candidate is string => Boolean(candidate))
      .filter((candidate) => !candidate.startsWith('parent#'))
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
  }

  // ==================================================================
  // Protocol search + deep dive
  // ==================================================================

  async searchProtocols(query = '', limit = 30): Promise<ProtocolSearchItem[]> {
    const protocols = await this.getProtocols();
    const needle = query.trim().toLowerCase();

    const filtered = needle
      ? protocols.filter(
          (p) =>
            (p.name ?? '').toLowerCase().includes(needle) ||
            (p.symbol ?? '').toLowerCase().includes(needle) ||
            String(p.id ?? '').toLowerCase().includes(needle),
        )
      : protocols;

    return filtered.slice(0, limit).map((p) => {
      const chains = Array.isArray(p.chains) ? p.chains : [];
      return {
        slug: String(p.slug ?? p.id ?? p.name ?? ''),
        symbol: (p.symbol ?? '').toUpperCase(),
        name: p.name ?? 'Unknown',
        logo: p.logo ?? '',
        category: p.category ?? 'Uncategorized',
        tvl: num(p.tvl),
        change7d: num(p.change_7d),
        chains,
        chainCount: chains.length,
        mcap: nullableNum(p.mcap),
      };
    });
  }

  async getCategories(): Promise<
    Array<{ category: string; count: number; totalTvl: number }>
  > {
    const protocols = await this.getProtocols();
    const buckets = new Map<string, { count: number; totalTvl: number }>();

    for (const protocol of protocols) {
      const category = protocol.category ?? 'Uncategorized';
      const bucket = buckets.get(category) ?? { count: 0, totalTvl: 0 };
      bucket.count += 1;
      bucket.totalTvl += num(protocol.tvl);
      buckets.set(category, bucket);
    }

    return [...buckets.entries()]
      .map(([category, value]) => ({ category, ...value }))
      .sort((a, b) => b.totalTvl - a.totalTvl);
  }

  async getDeepDive(slug: string): Promise<ProtocolDeepDive> {
    const protocols = await this.getProtocols();
    const needle = decodeURIComponent(String(slug ?? '')).trim().toLowerCase();
    const key = normalizeKey(needle);

    if (!key) {
      throw new NotFoundException('A protocol slug is required');
    }

    // Tier 1: exact id / symbol / name. Tier 2: normalized name/symbol so that
    // human slugs (`aave`, `aave-v3`, `curve-dex`) resolve to the real protocol.
    const exact = protocols.filter(
      (p) =>
        String(p.id ?? '').toLowerCase() === needle ||
        (p.symbol ?? '').toLowerCase() === needle ||
        (p.name ?? '').toLowerCase() === needle,
    );

    const fuzzy =
      exact.length > 0
        ? []
        : protocols.filter((p) => {
            const nameKey = normalizeKey(p.name);
            const symbolKey = normalizeKey(p.symbol);
            return (
              (nameKey !== '' && nameKey === key) ||
              (symbolKey !== '' && symbolKey === key) ||
              (key.length >= 3 && nameKey !== '' && nameKey.startsWith(key))
            );
          });

    // Several protocol versions can share a name (`Aave V2`, `Aave V3`): the
    // deepest one (highest TVL) is the one a user means when they type `aave`.
    // Parent protocols (`parent#aave`) aggregate several versions and expose no
    // chain data through the detail endpoint, so real protocol rows win.
    const pool = [...exact, ...fuzzy];
    const realProtocols = pool.filter(
      (protocol) => !String(protocol.id ?? '').startsWith('parent#'),
    );
    const ranked = (realProtocols.length > 0 ? realProtocols : pool).sort(
      (a, b) => num(b.tvl) - num(a.tvl),
    );

    const candidateIds: string[] = [];
    const pushCandidate = (value: unknown) => {
      const candidate = String(value ?? '').trim();
      if (!candidate || candidate.startsWith('parent#')) return;
      if (!candidateIds.includes(candidate)) candidateIds.push(candidate);
    };

    for (const protocol of ranked.slice(0, 8)) {
      pushCandidate(protocol.slug);
      pushCandidate(
        String(protocol.name ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      );
      pushCandidate(protocol.id ?? protocol.name);
    }
    // Last resort: the raw user slug (`aave` resolves to the parent aggregate).
    pushCandidate(needle);

    let detail: Record<string, unknown> | undefined;
    let usedId = candidateIds[0];
    for (const candidate of candidateIds) {
      try {
        detail = await this.fetchJson<Record<string, unknown>>(
          `${LLAMA}/protocol/${encodeURIComponent(candidate)}`,
        );
        usedId = candidate;
        break;
      } catch {
        // try the next candidate id
      }
    }

    if (!detail) {
      throw new NotFoundException(`Protocol "${slug}" was not found on DefiLlama`);
    }

    const summary =
      ranked.find((p) => String(p.id ?? '') === usedId) ?? ranked[0];

    const merged: LlamaProtocol = {
      ...(summary ?? {}),
      ...(detail as LlamaProtocol),
    };

    const chains = Array.isArray(merged.chains)
      ? merged.chains
      : Array.isArray((detail as { chains?: string[] }).chains)
        ? (detail as { chains?: string[] }).chains!
        : [];

    const currentChainTvls = ((detail.currentChainTvls ?? {}) as Record<string, unknown>);

    const chainBreakdown = Object.entries(currentChainTvls)
      .filter(
        ([chain]) =>
          !chain.includes('-') &&
          !['borrowed', 'staking', 'pool2', 'vesting', 'offers'].includes(chain),
      )
      .map(([chain, value]) => ({ chain, tvl: num(value) }))
      .filter((entry) => entry.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl);

    const totalTvl =
      num(merged.tvl) ||
      chainBreakdown.reduce((acc, entry) => acc + entry.tvl, 0);

    const historyRaw = Array.isArray(detail.tvl)
      ? (detail.tvl as Array<{ date?: number; totalLiquidityUSD?: number }>)
      : [];

    const history = historyRaw
      .slice(-120)
      .map((point) => ({
        date: num(point.date) * 1000,
        tvl: num(point.totalLiquidityUSD),
      }))
      .filter((point) => point.tvl > 0);

    let historyTrend: 'RISING' | 'FALLING' | 'FLAT' = 'FLAT';
    if (history.length >= 2) {
      const first = history[0].tvl;
      const last = history[history.length - 1].tvl;
      const change = first > 0 ? ((last - first) / first) * 100 : 0;
      historyTrend = change > 5 ? 'RISING' : change < -5 ? 'FALLING' : 'FLAT';
    }

    const mcap = nullableNum(merged.mcap);
    const fdv = nullableNum(merged.fdv);

    const fees = await this.getFees(usedId);

    const revenue24h = nullableNum(fees?.total24h);
    const revenue30d = nullableNum(fees?.total30d);
    const revenue1y = nullableNum(fees?.total1y);
    const volume24h = nullableNum(fees?.total24h);
    const volume7d = nullableNum(fees?.total7d);
    const volume30d = nullableNum(fees?.total30d);

    const feesHistory = Array.isArray(fees?.totalDataChart)
      ? (fees?.totalDataChart as Array<[number, number]>).slice(-120).map(([date, value]) => ({
          date: num(date) * 1000,
          value: num(value),
        }))
      : [];

    const feesBreakdown = Array.isArray(fees?.totalDataChartBreakdown) &&
      (fees?.totalDataChartBreakdown as unknown[]).length > 0
      ? this.buildFeesBreakdown(fees?.totalDataChartBreakdown as Array<[number, unknown]>)
      : [];

    const feesToTvlPercent =
      totalTvl > 0 && revenue24h !== null ? (revenue24h / totalTvl) * 100 : null;
    const volumeToTvlPercent =
      totalTvl > 0 && volume24h !== null ? (volume24h / totalTvl) * 100 : null;
    const annualizedRevenue30d = revenue30d !== null ? revenue30d * 12 : null;
    const annualizedFees30d = nullableNum(fees?.average1y);

    const chainShare = chainBreakdown.length > 0
      ? (chainBreakdown[0].tvl / Math.max(totalTvl, 1)) * 100
      : null;

    const activityScore = clamp(
      30 +
        (feesToTvlPercent !== null ? Math.min(40, feesToTvlPercent * 6) : 0) +
        (chainBreakdown.length >= 3 ? 10 : 0) +
        (volumeToTvlPercent !== null && volumeToTvlPercent > 1 ? 15 : 0),
    );

    const gecko = await this.getCoin(String(merged.gecko_id ?? ''));
    const tokenomics = this.buildTokenomics(gecko, mcap, fdv);

    const security = this.buildSecurity(detail, merged, totalTvl);
    const healthScore = this.buildHealthScore(
      totalTvl,
      num(merged.change_7d),
      annualizedRevenue30d,
      activityScore,
      mcap,
      security.securityScore,
    );

    const readiness =
      (reward: string | null, penalty: number, label: string, tone: 'GOOD' | 'NEUTRAL' | 'BAD') => ({
        label,
        value: reward ?? 'n/a',
        tone,
      });

    const valuation = {
      mcapToTvl: mcap !== null && totalTvl > 0 ? Number((mcap / totalTvl).toFixed(3)) : null,
      tvlToRevenueAnnualized:
        annualizedRevenue30d !== null && annualizedRevenue30d > 0
          ? Number((totalTvl / annualizedRevenue30d).toFixed(2))
          : null,
      feesToMcap: mcap !== null && mcap > 0 && annualizedRevenue30d !== null
        ? Number((annualizedRevenue30d / mcap) * 100)
        : null,
      labels: [
        readiness(
          mcap !== null && totalTvl > 0
            ? `$${mcap.toLocaleString()} MCap vs $${Math.round(totalTvl).toLocaleString()} TVL`
            : null,
          0,
          'MCap / TVL',
          mcap !== null && totalTvl > 0
            ? mcap / totalTvl < 1
              ? 'GOOD'
              : mcap / totalTvl > 5
                ? 'BAD'
                : 'NEUTRAL'
            : 'NEUTRAL',
        ),
        readiness(
          annualizedRevenue30d !== null
            ? `$${Math.round(annualizedRevenue30d).toLocaleString()} / year (annualized 30d)`
            : null,
          0,
          'Revenue',
          'NEUTRAL',
        ),
        readiness(
          security.isAudited ? 'Audits on file' : 'No audit listed',
          0,
          'Audits',
          security.isAudited ? 'GOOD' : 'BAD',
        ),
      ],
    };

    const warnings: string[] = [];
    if (security.hasHackHistory) warnings.push('This protocol has a hack history.');
    if (!security.isAudited) warnings.push('No audit is listed for this protocol.');
    if (mcap !== null && totalTvl > 0 && mcap / totalTvl > 5) {
      warnings.push('Market cap is more than 5x TVL — valuation looks stretched.');
    }
    if (num(merged.change_7d) < -15) warnings.push('TVL fell more than 15% in the last week.');
    if (annualizedRevenue30d === null) warnings.push('No fee data available from DefiLlama.');

    const listedAt = num(merged.listedAt);
    const ageInDays =
      listedAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - listedAt) / 86_400) : 0;

    return {
      identity: {
        slug: String(merged.slug ?? merged.id ?? usedId),
        name: merged.name ?? 'Unknown',
        symbol: (merged.symbol ?? '').toUpperCase(),
        logo: merged.logo ?? '',
        description: merged.description ?? '',
        url: merged.url ?? '',
        twitter: merged.twitter ?? null,
        category: merged.category ?? 'Uncategorized',
        chains,
        listedAt,
        ageInDays,
        geckoId: merged.gecko_id ?? null,
        methodology: merged.methodology ?? null,
      },
      tvl: {
        total: totalTvl,
        change1h: nullableNum(merged.change_1h),
        change1d: nullableNum(merged.change_1d),
        change7d: nullableNum(merged.change_7d),
        change1m: this.historyChange(history, 30),
        marketCap: mcap,
        fdv,
        mcapToTvl: mcap !== null && totalTvl > 0 ? Number((mcap / totalTvl).toFixed(3)) : null,
        tvlToMcap: mcap !== null && mcap > 0 ? Number((totalTvl / mcap).toFixed(3)) : null,
        chainBreakdown: chainBreakdown.map((entry) => ({
          ...entry,
          sharePercent:
            totalTvl > 0 ? Number(((entry.tvl / totalTvl) * 100).toFixed(2)) : 0,
        })),
        history,
        historyTrend,
      },
      revenue: {
        fees24h: revenue24h,
        fees7d: nullableNum(fees?.total7d),
        fees30d: revenue30d,
        fees1y: revenue1y,
        revenue24h,
        revenue30d,
        revenue1y,
        feesChange1d: nullableNum(fees?.change_1d),
        feesChange7d: nullableNum(fees?.change_7d),
        annualizedRevenue30d,
        annualizedFees30d,
        history: feesHistory,
        chainBreakdown: feesBreakdown,
        volume24h,
        volume7d,
        volume30d,
      },
      activity: {
        stablecoinSupplyUsd: null,
        stablecoinSharePercent: null,
        dominantChain: chainBreakdown[0]?.chain ?? null,
        feesToTvlPercent:
          feesToTvlPercent === null ? null : Number(feesToTvlPercent.toFixed(4)),
        volumeToTvlPercent:
          volumeToTvlPercent === null ? null : Number(volumeToTvlPercent.toFixed(4)),
        revenueMultiple: annualizedRevenue30d,
        chainsCount: chainBreakdown.length || chains.length,
        topChainSharePercent:
          chainShare === null ? null : Number(chainShare.toFixed(2)),
        activityScore: Number(activityScore.toFixed(1)),
      },
      tokenomics,
      security,
      valuation,
      healthScore,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }

  private historyChange(
    history: Array<{ date: number; tvl: number }>,
    days: number,
  ): number | null {
    if (history.length < 2) return null;
    const target = Date.now() - days * 86_400_000;
    const reference = history.find((point) => point.date >= target) ?? history[0];
    if (!reference || reference.tvl === 0) return null;
    const last = history[history.length - 1].tvl;
    return Number((((last - reference.tvl) / reference.tvl) * 100).toFixed(2));
  }

  private buildFeesBreakdown(
    chart: Array<[number, unknown]>,
  ): Array<{ chain: string; value: number; sharePercent: number }> {
    const last = chart[chart.length - 1];
    if (!last || typeof last[1] !== 'object' || last[1] === null) return [];

    const entries = Object.entries(last[1] as Record<string, number>)
      .map(([chain, value]) => ({ chain, value: num(value) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = entries.reduce((acc, entry) => acc + entry.value, 0);
    return entries.slice(0, 8).map((entry) => ({
      ...entry,
      sharePercent: total > 0 ? Number(((entry.value / total) * 100).toFixed(2)) : 0,
    }));
  }

  private async getFees(slug: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.fetchJson<Record<string, unknown>>(
        `${LLAMA}/summary/fees/${encodeURIComponent(slug)}`,
        { dataType: 'dailyFees' },
      );
    } catch {
      return null;
    }
  }

  private async getCoin(geckoId: string): Promise<CoinGeckoCoin | null> {
    if (!geckoId) return null;

    const cached = this.coinCache.get(geckoId);
    if (cached && Date.now() - cached.at < this.TTL) return cached.data;

    try {
      const data = await this.fetchJson<CoinGeckoCoin>(
        `${COINGECKO}/coins/${encodeURIComponent(geckoId)}`,
        {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
      );

      this.coinCache.set(geckoId, { at: Date.now(), data });
      return data;
    } catch {
      this.coinCache.set(geckoId, { at: Date.now(), data: null });
      return null;
    }
  }

  private buildTokenomics(
    coin: CoinGeckoCoin | null,
    fallbackMcap: number | null,
    fallbackFdv: number | null,
  ): ProtocolTokenomics {
    const market = coin?.market_data;
    const usd = (values?: Record<string, number>) => nullableNum(values?.usd);

    const circulating = nullableNum(market?.circulating_supply);
    const total = nullableNum(market?.total_supply);
    const max = nullableNum(market?.max_supply);
    const mcap = usd(market?.market_cap) ?? fallbackMcap;
    const fdv = usd(market?.fully_diluted_valuation) ?? fallbackFdv;

    return {
      marketCap: mcap,
      fdv,
      circulatingSupply: circulating,
      totalSupply: total,
      maxSupply: max,
      circulatingPercent:
        circulating !== null && (max ?? total) !== null && (max ?? total)! > 0
          ? Number((circulating / (max ?? total)!) * 100)
          : null,
      fdvToMcap:
        fdv !== null && mcap !== null && mcap > 0
          ? Number((fdv / mcap).toFixed(3))
          : null,
      price: usd(market?.current_price),
      priceChange24h: nullableNum(market?.price_change_percentage_24h),
      priceChange7d: nullableNum(market?.price_change_percentage_7d),
      priceChange30d: nullableNum(market?.price_change_percentage_30d),
      priceChange1y: nullableNum(market?.price_change_percentage_1y),
      ath: usd(market?.ath),
      athChangePercent: nullableNum(market?.ath_change_percentage?.usd),
      tokens: coin
        ? [
            {
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              decimals: Object.values(coin.detail_platforms ?? {})[0]?.decimal_place ?? null,
            },
          ]
        : [],
    };
  }

  private buildSecurity(
    detail: Record<string, unknown>,
    merged: LlamaProtocol,
    tvl: number,
  ) {
    const auditsRaw = merged.audits ?? detail.audits;
    const auditLinksRaw = merged.audit_links ?? detail.audit_links;

    const audits =
      auditsRaw === null || auditsRaw === undefined ? null : String(auditsRaw);

    let auditLinks: string[] | null = null;
    if (Array.isArray(auditLinksRaw)) {
      auditLinks = auditLinksRaw.map(String);
    } else if (typeof auditLinksRaw === 'string' && auditLinksRaw.trim()) {
      try {
        const parsed = JSON.parse(auditLinksRaw);
        auditLinks = Array.isArray(parsed) ? parsed.map(String) : [auditLinksRaw];
      } catch {
        auditLinks = auditLinksRaw.split(',').map((link) => link.trim()).filter(Boolean);
      }
    }

    const hacksRaw = detail.hacks;
    const hacks = Array.isArray(hacksRaw) && hacksRaw.length > 0
      ? hacksRaw.map((hack) =>
          typeof hack === 'string' ? hack : JSON.stringify(hack),
        )
      : null;

    const oracles =
      Array.isArray(detail.oracles) && detail.oracles.length > 0
        ? detail.oracles.map(String)
        : null;

    const isAudited =
      (audits !== null && audits !== '0' && audits.toLowerCase() !== 'no') ||
      (auditLinks !== null && auditLinks.length > 0);

    const hasHackHistory = hacks !== null && hacks.length > 0;

    let hackLossUsd = 0;
    if (Array.isArray(hacksRaw)) {
      for (const hack of hacksRaw) {
        if (hack && typeof hack === 'object') {
          hackLossUsd += num((hack as { amount?: number }).amount);
        }
      }
    }

    const latestHackDate =
      Array.isArray(hacksRaw) && hacksRaw.length > 0
        ? this.extractHackDate(hacksRaw[hacksRaw.length - 1])
        : null;

    const securityScore = clamp(
      50 + (isAudited ? 25 : 0) + (hasHackHistory ? -30 : 15) + (oracles ? 10 : 0),
    );

    return {
      audits,
      auditLinks,
      hacks,
      oracles,
      isAudited,
      hasHackHistory,
      hackLossUsd,
      hackLossToTvlPercent:
        hackLossUsd > 0 && tvl > 0 ? Number(((hackLossUsd / tvl) * 100).toFixed(2)) : 0,
      latestHackDate,
      securityScore,
    };
  }

  private extractHackDate(hack: unknown): number | null {
    if (!hack || typeof hack !== 'object') return null;
    const record = hack as { date?: number; timestamp?: number; name?: string };
    const value = record.date ?? record.timestamp;
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed > 1e12 ? parsed : parsed * 1000;
  }

  private buildHealthScore(
    tvl: number,
    growth7d: number,
    annualizedRevenue: number | null,
    activityScore: number,
    mcap: number | null,
    securityScore: number,
  ) {
    const tvlStrength = clamp(Math.log10(Math.max(tvl, 1)) * 10, 0, 100);
    const growth = clamp(50 + growth7d * 2, 0, 100);
    const revenueQuality =
      annualizedRevenue !== null && tvl > 0
        ? clamp(Math.log10(Math.max(annualizedRevenue / Math.max(tvl, 1), 1e-6)) * 20 + 60, 0, 100)
        : 45;
    const valuation =
      mcap !== null && tvl > 0
        ? clamp(100 - Math.abs(Math.log(mcap / tvl)) * 40, 0, 100)
        : 50;
    const tokenomics = mcap !== null ? 70 : 40;

    const total =
      tvlStrength * 0.22 +
      growth * 0.18 +
      revenueQuality * 0.2 +
      activityScore * 0.15 +
      valuation * 0.1 +
      securityScore * 0.1 +
      tokenomics * 0.05;

    const verdict =
      total >= 80
        ? 'STRONG_BUY'
        : total >= 68
          ? 'ACCUMULATE'
          : total >= 55
            ? 'HOLD'
            : total >= 42
              ? 'CAUTION'
              : 'AVOID';

    return {
      total: Number(total.toFixed(1)),
      tvlStrength: Number(tvlStrength.toFixed(1)),
      growth: Number(growth.toFixed(1)),
      revenueQuality: Number(revenueQuality.toFixed(1)),
      activity: Number(activityScore.toFixed(1)),
      valuation: Number(valuation.toFixed(1)),
      security: Number(securityScore.toFixed(1)),
      tokenomics: Number(tokenomics.toFixed(1)),
      verdict,
      summary:
        verdict === 'STRONG_BUY'
          ? 'Deep liquidity, growing TVL and real fee revenue.'
          : verdict === 'ACCUMULATE'
            ? 'Solid fundamentals with room for further growth.'
            : verdict === 'HOLD'
              ? 'Balanced fundamentals — wait for a clearer trend.'
              : verdict === 'CAUTION'
                ? 'Mixed signals; size positions carefully.'
                : 'Weak TVL, growth or security profile.',
    } as const;
  }

  // ==================================================================
  // Volume / Market cap
  // ==================================================================

  async getVolumeMarketCap(params: {
    minRatio?: number;
    minMarketCap?: number;
    limit?: number;
    pages?: number;
    refresh?: boolean;
    includeSqueeze?: boolean;
  }): Promise<VolumeMarketCapScanResult> {
    const minRatio = params.minRatio ?? 0.5;
    const minMarketCap = params.minMarketCap ?? 10_000_000;
    const limit = Math.min(params.limit ?? 100, 500);
    const pages = Math.max(1, Math.min(params.pages ?? 4, 10));

    const coins = await this.getMarketPages(pages, params.refresh === true);

    // Market caps come from CoinGecko; Binance is only used to enrich price.
    // If the exchange is unreachable the screen should still render.
    const tickers = await this.marketData
      .getTickerMap(params.refresh === true)
      .catch(() => new Map<string, FuturesTicker>());

    const matches: VolumeMarketCapMatch[] = [];

    for (const coin of coins) {
      const marketCap = num(coin.market_cap);
      const volume24h = num(coin.total_volume);
      if (marketCap < minMarketCap || marketCap <= 0) continue;

      const ratio = volume24h / marketCap;
      if (ratio < minRatio) continue;

      const pair = tickers.get(`${coin.symbol.toUpperCase()}USDT`);

      matches.push({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        image: coin.image,
        price: coin.current_price ?? pair?.lastPrice ?? null,
        marketCap,
        volume24h,
        ratio: Number(ratio.toFixed(4)),
        marketCapRank: coin.market_cap_rank ?? null,
        priceChange24h: coin.price_change_percentage_24h ?? pair?.priceChangePercent ?? null,
        circulatingSupply: coin.circulating_supply ?? null,
      });
    }

    matches.sort((a, b) => b.ratio - a.ratio);
    const trimmed = matches.slice(0, limit);

    if (params.includeSqueeze !== false) {
      const funding = await this.marketData.getFundingMap().catch(() => new Map());

      for (const match of trimmed.slice(0, 15)) {
        const pair = `${match.symbol}USDT`;
        const fundingRate = funding.get(pair);
        const oiChange = await this.marketData
          .getOpenInterestChange(pair, '1h', 25)
          .catch(() => null);

        match.longSqueeze = this.assessSqueeze(
          fundingRate ?? null,
          oiChange,
          match.priceChange24h,
        );
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalScanned: coins.length,
      pagesFetched: pages,
      criteria: { minRatio, minMarketCap },
      matches: trimmed,
    };
  }

  private assessSqueeze(
    fundingRate: number | null,
    oiChange: number | null,
    priceChange24h: number | null,
  ): LongSqueezeAssessment {
    if (fundingRate === null && oiChange === null) {
      return { level: 'UNKNOWN', score: 0, reason: 'No derivatives market for this asset' };
    }

    let score = 0;
    const reasons: string[] = [];

    if (fundingRate !== null && fundingRate > 0.0005) {
      score += Math.min(40, fundingRate * 40_000);
      reasons.push(`funding ${(fundingRate * 100).toFixed(4)}% (longs pay)`);
    }
    if (oiChange !== null && oiChange < 0) {
      score += 20;
      reasons.push(`OI ${oiChange.toFixed(1)}% (positions closing)`);
    }
    if (priceChange24h !== null && priceChange24h < -5) {
      score += 25;
      reasons.push(`price ${priceChange24h.toFixed(1)}% in 24h`);
    }

    const level =
      score >= 60 ? 'HIGH' : score >= 35 ? 'MEDIUM' : score > 0 ? 'LOW' : 'UNKNOWN';

    return {
      level,
      score: Number(clamp(score).toFixed(0)),
      reason: reasons.length > 0 ? reasons.join(' · ') : 'No squeeze pressure detected',
    };
  }

  private async getMarketPages(
    pages: number,
    refresh: boolean,
  ): Promise<CoinGeckoMarket[]> {
    const key = `markets:${pages}`;
    const cached = this.geckoCache.get(key);

    if (!refresh && cached && Date.now() - cached.at < this.CG_TTL) {
      return cached.data;
    }

    // Pages are independent: fetching them in parallel keeps a 4-page screen
    // at one round trip (~30s on a slow link) instead of four (~2 minutes).
    const pagesData = await Promise.all(
      Array.from({ length: pages }, (_, index) => {
        const page = index + 1;
        return this.fetchJson<CoinGeckoMarket[]>(`${COINGECKO}/coins/markets`, {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 250,
          page,
          sparkline: false,
          price_change_percentage: '24h',
        }).catch((error: unknown) => {
          this.logger.warn(
            `CoinGecko markets page ${page} failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          return [] as CoinGeckoMarket[];
        });
      }),
    );

    const collected: CoinGeckoMarket[] = [];
    for (const rows of pagesData) {
      if (!Array.isArray(rows) || rows.length === 0) break;
      collected.push(...rows);
    }

    this.geckoCache.set(key, { at: Date.now(), data: collected });
    return collected;
  }
}
