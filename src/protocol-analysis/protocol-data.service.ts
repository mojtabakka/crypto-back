import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  ProtocolSearchItem,
  ProtocolTvlData,
  ProtocolRevenueData,
  ProtocolTokenomics,
  ProtocolSecurity,
} from './types/protocol-analysis.types';

const LLAMA = 'https://api.llama.fi';
const STABLECOINS = 'https://stablecoins.llama.fi';
const COINGECKO = 'https://api.coingecko.com/api/v3';

/** Below this a "protocol" is dust and only adds noise to name searches. */
const MIN_SEARCHABLE_TVL = 100_000;

interface DefiLlamaProtocolListItem {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  logo: string;
  category: string;
  chains: string[];
  tvl: number;
  change_1d: number | null;
  change_7d: number | null;
  change_1m: number | null;
  mcap: number | null;
  listedAt: number;
  gecko_id: string | null;
  parentProtocol: string | null;
}

interface DefiLlamaHack {
  date: number | null;
  name: string | null;
  classification: string | null;
  technique: string | null;
  amount: number | null;
  chain: string[] | null;
}

interface DefiLlamaProtocolDetail {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  logo: string;
  description: string;
  url: string;
  twitter: string | null;
  category: string;
  chains: string[];
  listedAt: number;
  gecko_id: string | null;
  methodology: string | null;
  audits: string | null;
  audit_links: string[] | null;
  hacks: DefiLlamaHack[] | null;
  oracles: string[] | null;
  oraclesBreakdown: Record<string, unknown> | null;
  mcap: number | null;
  fdv: number | null;
  tvl: { date: number; totalLiquidityUSD: number }[];
  currentChainTvls: Record<string, number>;
  tokens: { symbol: string; name: string; decimals: number | null }[];
}

interface DefiLlamaFeesSummary {
  slug: string;
  name: string;
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  total1y: number | null;
  change_1d: number | null;
  change_7d: number | null;
  annualized1y: number | null;
  totalDataChart: [number, number][] | null;
  chainBreakdown: Record<string, number> | null;
  audits: string | null;
  audit_links: string[] | null;
  hacks: DefiLlamaHack[] | null;
  github: string[] | null;
}

interface DefiLlamaRevenueSummary {
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  total1y: number | null;
  change_1d: number | null;
  change_7d: number | null;
  annualized1y: number | null;
  totalDataChart: [number, number][] | null;
}

interface CoinGeckoCoin {
  id: string;
  market_data: {
    current_price: Record<string, number>;
    market_cap: Record<string, number>;
    fully_diluted_valuation: Record<string, number>;
    total_volume: Record<string, number>;
    circulating_supply: number;
    total_supply: number;
    max_supply: number | null;
    price_change_percentage_24h: number | null;
    price_change_percentage_7d: number | null;
    price_change_percentage_30d: number | null;
    price_change_percentage_1y: number | null;
    ath: Record<string, number>;
    ath_change_percentage: Record<string, number>;
  };
}

@Injectable()
export class ProtocolDataService {
  private readonly logger = new Logger(ProtocolDataService.name);

  private protocolsCache: { data: ProtocolSearchItem[]; ts: number } | null =
    null;
  private readonly PROTOCOLS_TTL = 10 * 60 * 1000;

  /**
   * DefiLlama mixes real chains with pseudo-bookkeeping keys in chain breakdowns
   * (staked, borrowed, pool2 ...). They are not chains and must not be shown as such.
   */
  private readonly PSEUDO_CHAINS = new Set([
    'staking',
    'pool2',
    'vesting',
    'offers',
    'incentives',
    'borrowed',
    'treasury',
    'debt',
    'tokens',
    'holders',
    'staking-borrowed',
  ]);

  constructor(private readonly httpService: HttpService) {}

  // ===================== SEARCH =====================

  async searchProtocols(query = '', limit = 30): Promise<ProtocolSearchItem[]> {
    const all = await this.getProtocolIndex();
    const q = query.trim().toLowerCase();

    if (!q) {
      return all.sort((a, b) => b.tvl - a.tvl).slice(0, limit);
    }

    // A name-match protocol with dust TVL is never what the user meant to pick,
    // and it would otherwise crowd out the real match in a short dropdown.
    const matched = all.filter(
      (p) =>
        p.tvl >= MIN_SEARCHABLE_TVL &&
        (p.name.toLowerCase().includes(q) ||
          p.symbol.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)),
    );

    return matched
      .sort((a, b) => {
        const aExact = a.symbol.toLowerCase() === q ? 1 : 0;
        const bExact = b.symbol.toLowerCase() === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aPrefix = a.symbol.toLowerCase().startsWith(q) ? 1 : 0;
        const bPrefix = b.symbol.toLowerCase().startsWith(q) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        // "Curve" should outrank "CrossCurve" even when the latter is larger.
        const aNamePrefix = a.name.toLowerCase().startsWith(q) ? 1 : 0;
        const bNamePrefix = b.name.toLowerCase().startsWith(q) ? 1 : 0;
        if (aNamePrefix !== bNamePrefix) return bNamePrefix - aNamePrefix;
        return b.tvl - a.tvl;
      })
      .slice(0, limit);
  }

  async getProtocolIndex(): Promise<ProtocolSearchItem[]> {
    if (
      this.protocolsCache &&
      Date.now() - this.protocolsCache.ts < this.PROTOCOLS_TTL
    ) {
      return this.protocolsCache.data;
    }

    const response = await firstValueFrom(
      this.httpService.get<DefiLlamaProtocolListItem[]>(`${LLAMA}/protocols`, {
        timeout: 30000,
      }),
    );

    const index = this.collapseIntoFamilies(response.data);

    this.protocolsCache = { data: index, ts: Date.now() };
    return index;
  }

  /**
   * DefiLlama exposes parent protocols plus one entry per version (Aave V2/V3/V4, Uniswap V2/V3/V4).
   * Users think in terms of the family, so collapse children into their parent when one exists.
   */
  private collapseIntoFamilies(
    items: DefiLlamaProtocolListItem[],
  ): ProtocolSearchItem[] {
    const valid = items.filter((p) => p.tvl > 0 && p.slug && p.symbol);

    const families = new Map<string, ProtocolSearchItem>();

    for (const item of valid) {
      const parentSlug = item.parentProtocol?.startsWith('parent#')
        ? item.parentProtocol.slice('parent#'.length)
        : null;
      const familySlug = parentSlug ?? item.slug;

      const existing = families.get(familySlug);
      if (existing) {
        existing.tvl += item.tvl;
        existing.mcap = existing.mcap ?? item.mcap;
        for (const chain of item.chains ?? []) {
          if (!existing.chains.includes(chain)) existing.chains.push(chain);
        }
        // A negative change on any member drags the family reading down
        if ((item.change_7d ?? 0) < (existing.change7d ?? 0)) {
          existing.change7d = item.change_7d ?? 0;
        }
        continue;
      }

      families.set(familySlug, {
        slug: familySlug,
        symbol: item.symbol,
        name: parentSlug
          ? parentSlug[0].toUpperCase() + parentSlug.slice(1)
          : item.name,
        logo: item.logo,
        category: item.category || 'Other',
        tvl: item.tvl,
        change7d: item.change_7d ?? 0,
        chains: [...(item.chains ?? [])],
        chainCount: (item.chains ?? []).length,
        mcap: item.mcap ?? null,
      });
    }

    return [...families.values()].map((entry) => ({
      ...entry,
      chainCount: entry.chains.length,
      name: entry.name || entry.symbol,
    }));
  }

  // ===================== CORE DATA =====================

  async fetchProtocolDetail(
    slug: string,
  ): Promise<DefiLlamaProtocolDetail | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<DefiLlamaProtocolDetail>(
          `${LLAMA}/protocol/${slug}`,
          {
            timeout: 20000,
          },
        ),
      );
      // DefiLlama returns slug: null on the detail endpoint, so normalize it here
      return { ...response.data, slug: response.data.slug ?? slug };
    } catch {
      this.logger.warn(`Failed to fetch protocol detail for ${slug}`);
      return null;
    }
  }

  async fetchFees(slug: string): Promise<DefiLlamaFeesSummary | null> {
    return this.fetchSummary(
      `${LLAMA}/summary/fees/${slug}?dataType=dailyFees`,
    );
  }

  async fetchRevenue(slug: string): Promise<DefiLlamaRevenueSummary | null> {
    return this.fetchSummary(
      `${LLAMA}/summary/fees/${slug}?dataType=dailyRevenue`,
    );
  }

  async fetchVolume(slug: string): Promise<DefiLlamaRevenueSummary | null> {
    return this.fetchSummary(`${LLAMA}/summary/dexs/${slug}`);
  }

  private async fetchSummary<T>(url: string): Promise<T | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, { timeout: 20000 }),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  async fetchChainStablecoinSupply(chain: string): Promise<number | null> {
    if (this.isPseudoChain(chain)) return null;
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ totalCirculating?: Record<string, number> }[]>(
          `${STABLECOINS}/stablecoincharts/${encodeURIComponent(chain)}`,
          { timeout: 8000 },
        ),
      );
      const chart = response.data;
      const latest = chart?.[chart.length - 1];
      if (!latest) return null;
      const supplies = Object.values(latest.totalCirculating ?? {});
      return supplies.length
        ? supplies.reduce<number>((sum, value) => sum + (value || 0), 0)
        : null;
    } catch {
      return null;
    }
  }

  async fetchCoinGecko(geckoId: string): Promise<CoinGeckoCoin | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoCoin>(`${COINGECKO}/coins/${geckoId}`, {
          params: {
            localization: false,
            tickers: false,
            community_data: false,
            developer_data: false,
            sparkline: false,
          },
          timeout: 8000,
        }),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  // ===================== TRANSFORMERS =====================

  buildTvlData(
    detail: DefiLlamaProtocolDetail,
    protocolsIndex?: ProtocolSearchItem[],
  ): ProtocolTvlData {
    const history = (detail.tvl ?? [])
      .filter((p) => Number.isFinite(p.totalLiquidityUSD))
      .map((p) => ({ date: p.date, tvl: p.totalLiquidityUSD }));

    const total = history.length ? history[history.length - 1].tvl : 0;

    const indexEntry = protocolsIndex?.find((p) => p.slug === detail.slug);
    const change7d = indexEntry?.change7d ?? this.pctChange(history, 7);
    const change1d = this.pctChange(history, 1);
    const change1h = this.pctChange(history, 1 / 24);
    const change1m = this.pctChange(history, 30);

    const chainBreakdown = Object.entries(detail.currentChainTvls ?? {})
      .filter(([key, value]) => value > 0 && !this.isPseudoChain(key))
      .map(([chain, tvl]) => ({
        chain,
        tvl,
        sharePercent: total > 0 ? (tvl / total) * 100 : 0,
      }))
      .sort((a, b) => b.tvl - a.tvl);

    const marketCap = detail.mcap ?? null;
    const fdv = detail.fdv ?? null;

    return {
      total,
      change1h,
      change1d,
      change7d,
      change1m,
      marketCap,
      fdv,
      mcapToTvl: marketCap && total > 0 ? marketCap / total : null,
      tvlToMcap: marketCap && marketCap > 0 ? total / marketCap : null,
      chainBreakdown: chainBreakdown.slice(0, 12),
      history: this.downsample(history, 120),
      historyTrend: this.trendOf(history, 30),
    };
  }

  buildRevenueData(
    fees: DefiLlamaFeesSummary | null,
    revenue: DefiLlamaRevenueSummary | null,
    volume: DefiLlamaRevenueSummary | null,
  ): ProtocolRevenueData {
    const chartSource = fees?.totalDataChart ?? revenue?.totalDataChart ?? [];
    const history = chartSource
      .filter((point) => Array.isArray(point) && Number.isFinite(point[1]))
      .map(([date, value]) => ({ date, value }));

    const chainBreakdown = Object.entries(fees?.chainBreakdown ?? {})
      .filter(([, value]) => value > 0)
      .map(([chain, value]) => ({
        chain,
        value,
        sharePercent: fees && fees.total30d ? (value / fees.total30d) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Always annualize from the 30-day window so fees/TVL and the valuation
    // ratios stay internally consistent. Fees stay fees-based: the protocol
    // revenue split is net of incentives and must not leak into the fee figure.
    const annualizedRevenue30d = revenue?.total30d
      ? revenue.total30d * 12
      : (revenue?.total1y ?? null);
    const annualizedFees30d = fees?.total30d
      ? fees.total30d * 12
      : (fees?.total1y ?? null);

    return {
      fees24h: fees?.total24h ?? null,
      fees7d: fees?.total7d ?? null,
      fees30d: fees?.total30d ?? null,
      fees1y: fees?.total1y ?? null,
      revenue24h: revenue?.total24h ?? null,
      revenue30d: revenue?.total30d ?? null,
      revenue1y: revenue?.total1y ?? null,
      feesChange1d: fees?.change_1d ?? null,
      feesChange7d: fees?.change_7d ?? null,
      annualizedRevenue30d,
      annualizedFees30d,
      history: this.downsample(history, 120),
      chainBreakdown,
      volume24h: volume?.total24h ?? null,
      volume7d: volume?.total7d ?? null,
      volume30d: volume?.total30d ?? null,
    };
  }

  buildTokenomics(
    detail: DefiLlamaProtocolDetail,
    coin: CoinGeckoCoin | null,
    indexEntry?: ProtocolSearchItem,
  ): ProtocolTokenomics {
    const md = coin?.market_data;
    // Child protocols (Aave V3, Uniswap V4, ...) report no market cap on their own,
    // so fall back to the family-level entry from the protocol index.
    const price = md?.current_price?.usd ?? null;
    const marketCap =
      md?.market_cap?.usd ?? detail.mcap ?? indexEntry?.mcap ?? null;
    const fdv = md?.fully_diluted_valuation?.usd ?? detail.fdv ?? null;
    const circulating = md?.circulating_supply ?? null;
    const totalSupply = md?.total_supply ?? null;
    const maxSupply = md?.max_supply ?? null;

    return {
      marketCap,
      fdv,
      circulatingSupply: circulating,
      totalSupply,
      maxSupply,
      circulatingPercent:
        totalSupply && circulating ? (circulating / totalSupply) * 100 : null,
      fdvToMcap: marketCap && fdv ? fdv / marketCap : null,
      price,
      priceChange24h: md?.price_change_percentage_24h ?? null,
      priceChange7d: md?.price_change_percentage_7d ?? null,
      priceChange30d: md?.price_change_percentage_30d ?? null,
      priceChange1y: md?.price_change_percentage_1y ?? null,
      ath: md?.ath?.usd ?? null,
      athChangePercent: md?.ath_change_percentage?.usd ?? null,
      tokens: (detail.tokens ?? []).slice(0, 20),
    };
  }

  buildSecurity(
    detail: DefiLlamaProtocolDetail,
    fees: DefiLlamaFeesSummary | null,
  ): ProtocolSecurity {
    const audits = detail.audits ?? fees?.audits ?? null;
    const auditLinks = detail.audit_links ?? fees?.audit_links ?? null;
    const hacks = detail.hacks ?? fees?.hacks ?? null;
    const oracles =
      detail.oracles ??
      (detail.oraclesBreakdown ? Object.keys(detail.oraclesBreakdown) : null);

    const isAudited = Boolean(audits || (auditLinks && auditLinks.length > 0));

    // A 2020 $220k incident on a multi-billion TVL protocol is noise; a
    // nine-figure loss or a recent exploit is not. Weight by size and age.
    const tvl = detail.tvl?.length
      ? detail.tvl[detail.tvl.length - 1].totalLiquidityUSD
      : 0;
    const nowSec = Date.now() / 1000;
    const hackList = hacks ?? [];
    const hackLoss = hackList.reduce((sum, h) => sum + (h.amount ?? 0), 0);
    const lossToTvl = tvl > 0 && hackLoss > 0 ? hackLoss / tvl : 0;
    const latestHack = hackList.reduce<number>(
      (latest, h) => Math.max(latest, h.date ?? 0),
      0,
    );
    const hackAgeDays = latestHack ? (nowSec - latestHack) / 86400 : Infinity;

    const isMaterial =
      hackLoss > 0 &&
      (lossToTvl > 0.005 ||
        hackLoss > 10_000_000 ||
        (hackLoss > 1_000_000 && hackAgeDays < 365));
    const hasHackHistory = isMaterial;

    let securityScore = 50;
    if (isAudited)
      securityScore += audits && audits !== '0' && audits !== '1' ? 25 : 15;
    if (auditLinks && auditLinks.length >= 2) securityScore += 10;
    if (oracles && oracles.length > 0) securityScore += 10;
    if (hackList.length > 0) securityScore -= isMaterial ? 35 : 5;

    return {
      audits,
      auditLinks,
      hacks: hackList.length
        ? hackList.map((h) => h.name ?? h.classification ?? 'Unknown incident')
        : null,
      oracles,
      isAudited,
      hasHackHistory,
      hackLossUsd: hackLoss,
      hackLossToTvlPercent: lossToTvl * 100,
      latestHackDate: latestHack || null,
      securityScore: Math.max(0, Math.min(100, securityScore)),
    };
  }

  // ===================== HELPERS =====================

  private pctChange(
    series: { date: number; tvl: number }[],
    days: number,
  ): number | null {
    if (series.length < 2) return null;
    const latest = series[series.length - 1].tvl;
    const cutoff = Date.now() / 1000 - days * 86400;
    const target = series.filter((p) => p.date <= cutoff).pop() ?? null;
    const reference = target ? target.tvl : series[series.length - 2].tvl;

    if (!reference || reference === 0) return null;
    return ((latest - reference) / reference) * 100;
  }

  private trendOf(
    series: { date: number; tvl: number }[],
    days: number,
  ): 'RISING' | 'FALLING' | 'FLAT' {
    const change = this.pctChange(series, days);
    if (change === null) return 'FLAT';
    if (change > 5) return 'RISING';
    if (change < -5) return 'FALLING';
    return 'FLAT';
  }

  private isPseudoChain(key: string): boolean {
    if (this.PSEUDO_CHAINS.has(key)) return true;
    return /-(borrowed|staking|pool2)$/.test(key);
  }

  private downsample<T extends { date: number }>(
    series: T[],
    maxPoints: number,
  ): T[] {
    if (series.length <= maxPoints) return series;
    const step = Math.ceil(series.length / maxPoints);
    const result: T[] = [];
    for (let i = 0; i < series.length; i += step) result.push(series[i]);
    const last = series[series.length - 1];
    if (result[result.length - 1] !== last) result.push(last);
    return result;
  }
}
