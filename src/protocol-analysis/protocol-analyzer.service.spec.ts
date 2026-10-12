import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ProtocolDataService } from './protocol-data.service';
import { ProtocolAnalyzerService } from './protocol-analyzer.service';

const DAY = 86400;

function makeSeries(days: number, start: number, end: number) {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: days }, (_, i) => ({
    date: now - (days - i) * DAY,
    totalLiquidityUSD: Math.round(start + ((end - start) * i) / (days - 1)),
  }));
}

/** Growing TVL series ending at the same total as the real chain buckets. */
function makeTvlSeries() {
  return makeSeries(90, 900_000_000, 1_150_000_000);
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aave',
    name: 'Aave',
    symbol: 'AAVE',
    slug: 'aave',
    logo: 'https://icons.llamao.fi/icons/protocols/aave',
    description: 'Lending protocol',
    url: 'https://aave.com',
    twitter: 'aave',
    category: '',
    chains: [],
    listedAt: Math.floor(Date.now() / 1000) - 400 * DAY,
    gecko_id: 'aave',
    methodology: null,
    audits: '2',
    audit_links: ['https://example.com/audit'],
    hacks: [],
    oracles: ['Chainlink'],
    tvl: makeTvlSeries(),
    currentChainTvls: {
      Ethereum: 1_000_000_000,
      'Ethereum-borrowed': 500_000_000,
      'Ethereum-staking': 300_000_000,
      Base: 100_000_000,
      Arbitrum: 50_000_000,
    },
    mcap: 4_000_000_000,
    chainTvls: {},
    tokens: [],
    ...overrides,
  } as never;
}

describe('ProtocolAnalyzerService', () => {
  let analyzer: ProtocolAnalyzerService;
  let dataService: ProtocolDataService;

  const baseTvlData = () => ({
    total: 1_150_000_000,
    change1h: null,
    change1d: 1,
    change7d: 2,
    change1m: 10,
    marketCap: 4_000_000_000,
    fdv: null,
    mcapToTvl: 3.47,
    tvlToMcap: 0.29,
    chainBreakdown: [
      { chain: 'Ethereum', tvl: 1_000_000_000, sharePercent: 86.9 },
      { chain: 'Base', tvl: 100_000_000, sharePercent: 8.7 },
      { chain: 'Arbitrum', tvl: 50_000_000, sharePercent: 4.3 },
    ],
    history: makeTvlSeries().map((p) => ({
      date: p.date,
      tvl: p.totalLiquidityUSD,
    })),
    historyTrend: 'RISING' as const,
  });

  const baseRevenueData = () => ({
    fees24h: 1_000_000,
    fees7d: 7_000_000,
    fees30d: 30_000_000,
    fees1y: 365_000_000,
    revenue24h: 100_000,
    revenue30d: 3_000_000,
    revenue1y: 36_000_000,
    feesChange1d: 1,
    feesChange7d: 2,
    annualizedRevenue30d: 36_000_000,
    annualizedFees30d: 365_000_000,
    history: makeSeries(30, 1_000_000, 1_200_000).map((p) => ({
      date: p.date,
      value: p.totalLiquidityUSD,
    })),
    chainBreakdown: [],
    volume24h: 2_000_000,
    volume7d: 14_000_000,
    volume30d: 60_000_000,
  });

  const baseTokenomics = () => ({
    marketCap: 4_000_000_000,
    fdv: null,
    circulatingSupply: 15_000_000,
    totalSupply: 16_000_000,
    maxSupply: null,
    circulatingPercent: 93.75,
    fdvToMcap: null,
    price: 260,
    priceChange24h: 1,
    priceChange7d: 2,
    priceChange30d: 5,
    priceChange1y: 20,
    ath: 660,
    athChangePercent: -60,
    tokens: [],
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProtocolAnalyzerService,
        ProtocolDataService,
        { provide: HttpService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    dataService = moduleRef.get(ProtocolDataService);
    analyzer = moduleRef.get(ProtocolAnalyzerService);
  });

  describe('buildTvlData', () => {
    it('excludes pseudo-chain buckets from the chain breakdown', () => {
      const tvl = dataService.buildTvlData(makeDetail());

      const chains = tvl.chainBreakdown.map((c) => c.chain);
      expect(chains).toEqual(['Ethereum', 'Base', 'Arbitrum']);
      expect(chains).not.toContain('Ethereum-borrowed');
      expect(chains).not.toContain('Ethereum-staking');
    });

    it('derives share percentages from real chains only', () => {
      const tvl = dataService.buildTvlData(makeDetail());

      const sum = tvl.chainBreakdown.reduce(
        (acc, c) => acc + c.sharePercent,
        0,
      );
      expect(sum).toBeCloseTo(100, 1);
    });

    it('falls back to a flat history when the chain has no series', () => {
      const tvl = dataService.buildTvlData(makeDetail());
      expect(tvl.history.length).toBeGreaterThan(0);
      expect(tvl.historyTrend).toBe('RISING');
    });
  });

  describe('buildRevenueData', () => {
    it('keeps annualized fees separate from annualized revenue', () => {
      const fees = {
        total24h: 1_000_000,
        total7d: 7_000_000,
        total30d: 30_000_000,
        total1y: 365_000_000,
        change_1d: 1,
        change_7d: 2,
        totalDataChart: makeSeries(30, 1_000_000, 1_200_000),
        totalDataChartBreakdown: [],
      };
      const revenue = {
        total24h: 100_000,
        total30d: 3_000_000,
        total1y: 36_000_000,
        totalDataChart: makeSeries(30, 100_000, 120_000),
        totalDataChartBreakdown: [],
      };

      const result = dataService.buildRevenueData(
        fees as never,
        revenue as never,
        null,
      );

      expect(result.fees30d).toBe(30_000_000);
      expect(result.revenue30d).toBe(3_000_000);
      expect(result.annualizedRevenue30d).toBe(36_000_000);
      expect(result.annualizedFees30d).toBe(360_000_000);
    });

    it('tolerates missing fee and volume payloads', () => {
      const result = dataService.buildRevenueData(null, null, null);

      expect(result.fees24h).toBeNull();
      expect(result.annualizedRevenue30d).toBeNull();
      expect(result.history).toEqual([]);
    });
  });

  describe('buildSecurity', () => {
    it('flags a no-hack protocol as secure', () => {
      const security = dataService.buildSecurity(makeDetail(), null);

      expect(security.isAudited).toBe(true);
      expect(security.hasHackHistory).toBe(false);
      expect(security.hackLossUsd).toBe(0);
      expect(security.securityScore).toBeGreaterThanOrEqual(80);
    });

    it('downgrades security for an old hack and reports the loss', () => {
      const detail = makeDetail({
        hacks: [
          {
            date: Math.floor(Date.now() / 1000) - 200 * DAY,
            name: 'Old exploit',
            classification: 'Business Logic',
            technique: null,
            amount: 50_000_000,
            chain: ['Ethereum'],
          },
        ],
      });

      const security = dataService.buildSecurity(detail, null);

      expect(security.hasHackHistory).toBe(true);
      expect(security.hackLossUsd).toBe(50_000_000);
      expect(security.securityScore).toBeLessThan(60);
      expect(security.latestHackDate).toBeGreaterThan(0);
    });

    it('treats a recent material hack as severe', () => {
      const detail = makeDetail({
        hacks: [
          {
            date: Math.floor(Date.now() / 1000) - 30 * DAY,
            name: 'Recent exploit',
            classification: 'Reentrancy',
            technique: null,
            amount: 60_000_000,
            chain: ['Ethereum'],
          },
        ],
      });

      const security = dataService.buildSecurity(detail, null);

      expect(security.securityScore).toBeLessThan(60);
      expect(security.hackLossToTvlPercent).toBeGreaterThan(0);
    });
  });

  describe('searchProtocols', () => {
    const indexEntry = (
      slug: string,
      name: string,
      symbol: string,
      tvl: number,
    ) => ({
      slug,
      symbol,
      name,
      logo: '',
      category: 'Dexs',
      tvl,
      change7d: 0,
      chains: ['Ethereum'],
      chainCount: 1,
      mcap: null,
    });

    beforeEach(() => {
      jest
        .spyOn(dataService, 'getProtocolIndex')
        .mockResolvedValue([
          indexEntry('curve-finance', 'Curve-finance', 'CRV', 1_570_000_000),
          indexEntry('crosscurve', 'CrossCurve', 'EYWA', 5_000),
          indexEntry('vault-curve', 'VaultMintCurve', 'VMINT', 1_000),
          indexEntry('curve', 'Curve Stableswap', 'crvUSD', 200_000_000),
        ]);
    });

    it('drops dust protocols from name matches', async () => {
      const results = await dataService.searchProtocols('curve');

      expect(results.map((r) => r.name)).not.toContain('CrossCurve');
      expect(results.map((r) => r.name)).not.toContain('VaultMintCurve');
    });

    it('ranks a name-prefix match above a larger substring match', async () => {
      const results = await dataService.searchProtocols('curve', 1);

      expect(results[0].name).toBe('Curve-finance');
    });

    it('ranks an exact symbol match first', async () => {
      const results = await dataService.searchProtocols('crv', 1);

      expect(results[0].symbol).toBe('CRV');
    });

    it('returns the largest protocols when the query is empty', async () => {
      const results = await dataService.searchProtocols('', 2);

      expect(results).toHaveLength(2);
      expect(results[0].tvl).toBeGreaterThanOrEqual(results[1].tvl);
    });
  });

  describe('analyze', () => {
    beforeEach(() => {
      jest
        .spyOn(dataService, 'fetchProtocolDetail')
        .mockResolvedValue(makeDetail());
      jest.spyOn(dataService, 'getProtocolIndex').mockResolvedValue([
        {
          slug: 'aave',
          symbol: 'AAVE',
          name: 'Aave',
          logo: 'logo',
          category: 'Lending',
          tvl: 1_150_000_000,
          change7d: 2,
          chains: ['Ethereum', 'Base', 'Arbitrum'],
          chainCount: 3,
          mcap: 4_000_000_000,
        },
      ]);
      jest
        .spyOn(dataService, 'fetchChainStablecoinSupply')
        .mockResolvedValue(50_000_000_000);
      jest.spyOn(dataService, 'fetchFees').mockResolvedValue(null);
      jest.spyOn(dataService, 'fetchRevenue').mockResolvedValue(null);
      jest.spyOn(dataService, 'fetchVolume').mockResolvedValue(null);
      jest.spyOn(dataService, 'fetchCoinGecko').mockResolvedValue(null);
      // Upstream fee/revenue endpoints are not part of this fixture, so the
      // scoring path gets a deterministic revenue shape instead.
      jest
        .spyOn(dataService, 'buildRevenueData')
        .mockReturnValue(baseRevenueData());
    });

    it('returns null for an unknown protocol', async () => {
      jest.spyOn(dataService, 'fetchProtocolDetail').mockResolvedValue(null);
      await expect(analyzer.analyze('does-not-exist')).resolves.toBeNull();
    });

    it('backfills category and chains from the index for parent protocols', async () => {
      const result = await analyzer.analyze('aave');

      expect(result?.identity.category).toBe('Lending');
      expect(result?.identity.chains).toEqual(['Ethereum', 'Base', 'Arbitrum']);
      expect(result?.identity.ageInDays).toBeGreaterThan(300);
    });

    it('scores a healthy growing protocol in the positive range', async () => {
      const result = await analyzer.analyze('aave');

      expect(result).not.toBeNull();
      expect(result!.healthScore.total).toBeGreaterThan(60);
      expect(['STRONG_BUY', 'ACCUMULATE']).toContain(
        result!.healthScore.verdict,
      );
      expect(result!.healthScore.total).toBeLessThanOrEqual(100);
      expect(result!.healthScore.total).toBeGreaterThanOrEqual(0);
    });

    it('warns about single-chain concentration', async () => {
      jest.spyOn(dataService, 'buildTvlData').mockReturnValue({
        ...baseTvlData(),
        chainBreakdown: [
          { chain: 'Ethereum', tvl: 1_150_000_000, sharePercent: 100 },
        ],
      });
      jest
        .spyOn(dataService, 'buildRevenueData')
        .mockReturnValue(baseRevenueData());
      jest
        .spyOn(dataService, 'buildTokenomics')
        .mockReturnValue(baseTokenomics());

      const result = await analyzer.analyze('aave');

      expect(result!.warnings.join(' ')).toMatch(/single-chain/i);
    });

    it('never pulls stablecoin float for more than the top two chains', async () => {
      const spy = jest.spyOn(dataService, 'fetchChainStablecoinSupply');

      await analyzer.analyze('aave');

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('Ethereum');
      expect(spy).toHaveBeenCalledWith('Base');
    });

    it('reports dominant chain and float share for the TVL chains', async () => {
      const result = await analyzer.analyze('aave');

      expect(result!.activity.dominantChain).toBe('Ethereum');
      expect(result!.activity.chainsCount).toBe(3);
      expect(result!.activity.stablecoinSupplyUsd).toBe(50_000_000_000);
      expect(result!.activity.stablecoinSharePercent).toBeCloseTo(2.3, 1);
    });

    it('flags a protocol whose hack outweighs its fundamentals', async () => {
      jest.spyOn(dataService, 'buildSecurity').mockReturnValue({
        audits: null,
        auditLinks: null,
        hacks: ['Curve reentrancy'],
        oracles: null,
        isAudited: false,
        hasHackHistory: true,
        hackLossUsd: 62_270_000,
        hackLossToTvlPercent: 4,
        latestHackDate: Math.floor(Date.now() / 1000) - 60 * DAY,
        securityScore: 10,
      });

      const result = await analyzer.analyze('aave');

      expect(result!.healthScore.verdict).toBe('AVOID');
      expect(result!.security.hackLossUsd).toBe(62_270_000);
    });
  });
});
