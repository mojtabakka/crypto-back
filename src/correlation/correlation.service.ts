import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CorrelationSnapshotEntity } from './entities/correlation-snapshot.entity';
import { CorrelationPairEntity } from './entities/correlation-pair.entity';
import { KlineService } from '../kline/kline.service';
import { FuturesSymbolsService } from '../futures-symbols/futures-symbols.service';
import { RedisService } from '../redis/redis.service';
import { NotificationGateway } from '../notification/notification.gateway';

const CACHE_KEY = 'correlation:latest';
const CACHE_TTL = 30 * 60;

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  /** Liquid USDT perpetuals, ordered by volume so the top slice is relevant. */
  private readonly UNIVERSE = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'MATICUSDT', 'LTCUSDT', 'TRXUSDT', 'ATOMUSDT', 'UNIUSDT',
    'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
    'FILUSDT', 'ETCUSDT', 'HBARUSDT', 'IMXUSDT', 'SUIUSDT',
  ];

  private isRunning = false;

  constructor(
    @InjectRepository(CorrelationSnapshotEntity)
    private readonly snapshotRepository: Repository<CorrelationSnapshotEntity>,
    @InjectRepository(CorrelationPairEntity)
    private readonly pairRepository: Repository<CorrelationPairEntity>,
    private readonly klineService: KlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly redisService: RedisService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  /**
   * Pearson correlation over aligned log returns.
   *
   * Returns are used rather than raw prices because price series are
   * non-stationary: correlating levels would report a high number for
   * any two assets that both drifted upward, which is meaningless.
   */
  pearson(a: number[], b: number[]): number | null {
    const n = Math.min(a.length, b.length);
    if (n < 3) return null;

    const x = a.slice(0, n);
    const y = b.slice(0, n);

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
    }

    const meanX = sumX / n;
    const meanY = sumY / n;

    let cov = 0;
    let varX = 0;
    let varY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    // A flat series has no variance, so correlation is undefined.
    if (varX === 0 || varY === 0) return null;

    const corr = cov / Math.sqrt(varX * varY);
    return Math.max(-1, Math.min(1, corr));
  }

  /**
   * Converts a price series into log returns, dropping any non-finite
   * or non-positive price which would break the logarithm. Accepts raw
   * decimal strings from the database as well as numbers.
   */
  toLogReturns(closes: readonly (string | number)[]): number[] {
    const prices = closes
      .map((v) => (typeof v === 'string' ? parseFloat(v) : v))
      .filter((p) => Number.isFinite(p) && p > 0);

    const returns: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }

    return returns;
  }

  /**
   * Average of the off-diagonal correlations, which measures how tightly
   * the market moves as one. High values mean diversification is hard.
   */
  private averageOffDiagonal(matrix: number[][]): number {
    const n = matrix.length;
    if (n < 2) return 0;

    let sum = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const value = matrix[i][j];
        if (Number.isFinite(value)) {
          sum += value;
          count++;
        }
      }
    }

    return count === 0 ? 0 : sum / count;
  }

  /**
   * Groups symbols by average absolute correlation using a simple
   * threshold sweep. Chosen over k-means because it needs no iteration
   * count tuning and produces stable groups for small universes.
   */
  private cluster(
    symbols: string[],
    matrix: number[][],
    threshold = 0.6,
  ): { name: string; symbols: string[] }[] {
    const n = symbols.length;
    if (n === 0) return [];

    const visited = new Set<number>();
    const groups: number[][] = [];

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;

      const group = [i];
      visited.add(i);

      for (let j = i + 1; j < n; j++) {
        if (visited.has(j)) continue;

        let sum = 0;
        let count = 0;

        for (const k of group) {
          const v = matrix[k][j];
          if (Number.isFinite(v)) {
            sum += v;
            count++;
          }
        }

        const avg = count === 0 ? 0 : sum / count;

        if (avg >= threshold) {
          group.push(j);
          visited.add(j);
        }
      }

      groups.push(group);
    }

    return groups
      .map((group) => ({
        name: group.length === 1 ? symbols[group[0]] : `Cluster ${groups.indexOf(group) + 1}`,
        symbols: group.map((i) => symbols[i]),
      }))
      .sort((a, b) => b.symbols.length - a.symbols.length);
  }

  private classify(correlation: number): string {
    if (correlation >= 0.85) return 'LOCKED';
    if (correlation >= 0.65) return 'HIGH';
    if (correlation >= 0.35) return 'MODERATE';
    if (correlation >= 0.1) return 'LOW';
    return 'NEGATIVE';
  }

  /**
   * Builds the full correlation matrix for the configured universe using
   * one shared time window so every series is aligned.
   */
  async buildMatrix(interval = '4h', lookbackDays = 30) {
    const endTime = Date.now();
    const startTime = endTime - lookbackDays * 24 * 60 * 60 * 1000;

    const stored = await this.futuresSymbolsService.getStoredSymbols();
    const known = new Set(
      (stored?.symbols ?? []).map((s: any) =>
        (typeof s === 'string' ? s : s.symbol).toUpperCase(),
      ),
    );

    const targets = this.UNIVERSE.filter((s) => known.size === 0 || known.has(s));
    const symbols = targets.length >= 5 ? targets : this.UNIVERSE;

    this.logger.log(
      `Building correlation matrix for ${symbols.length} symbols (${interval}, ${lookbackDays}d)`,
    );

    const returnsBySymbol = new Map<string, number[]>();
    const barsBySymbol = new Map<string, Map<number, number>>();

    for (const symbol of symbols) {
      try {
        const klines = await this.klineService.getKlines(
          symbol,
          interval,
          startTime,
          endTime,
        );

        if (!klines || klines.length < 10) {
          this.logger.warn(`Skipping ${symbol}: only ${klines?.length ?? 0} klines`);
          continue;
        }

        const priceByTime = new Map<number, number>();
        const closes: string[] = [];

        for (const k of klines) {
          const close = parseFloat(k[4]);
          if (!Number.isFinite(close) || close <= 0) continue;
          priceByTime.set(k[0], close);
          closes.push(String(close));
        }

        if (closes.length < 10) continue;

        returnsBySymbol.set(symbol, this.toLogReturns(closes));
        barsBySymbol.set(symbol, priceByTime);
      } catch (error) {
        this.logger.warn(
          `Failed loading ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Only keep symbols that actually have data, so the matrix is square.
    const usable = [...returnsBySymbol.keys()];

    if (usable.length < 2) {
      return {
        symbols: usable,
        matrix: usable.map((_, i) => usable.map((__, j) => (i === j ? 1 : 0))),
        averageCorrelation: 0,
        clusters: [],
        benchmark: 'BTCUSDT',
        observations: 0,
      };
    }

    // Align on common timestamps: pairwise correlation of misaligned
    // series would compare different market moments.
    const aligned = this.alignReturns(usable, barsBySymbol);

    const size = aligned.length;

    // Every row must exist before the loops start, because each pair
    // writes to both [i][j] and [j][i].
    const matrix: number[][] = Array.from({ length: size }, () =>
      new Array(size).fill(0),
    );

    for (let i = 0; i < size; i++) {
      matrix[i][i] = 1;
    }

    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const corr = this.pearson(aligned[i].returns, aligned[j].returns);
        const value = corr === null ? 0 : corr;

        matrix[i][j] = value;
        matrix[j][i] = value;
      }
    }

    const averageCorrelation = this.averageOffDiagonal(matrix);
    const clusters = this.cluster(usable, matrix);

    this.logger.log(
      `Matrix ready: ${usable.length} symbols, avg correlation ${averageCorrelation.toFixed(3)}`,
    );

    return {
      symbols: usable,
      matrix,
      averageCorrelation,
      clusters,
      benchmark: usable.includes('BTCUSDT') ? 'BTCUSDT' : usable[0],
      observations: aligned[0]?.returns.length ?? 0,
    };
  }

  /**
   * Restricts every symbol to the timestamps present in all series and
   * recomputes returns over that shared window.
   */
  private alignReturns(
    symbols: string[],
    priceBySymbol: Map<string, Map<number, number>>,
  ): { symbol: string; returns: number[] }[] {
    const timestampSets = symbols.map((symbol) => {
      const map = priceBySymbol.get(symbol);
      return new Set(map ? [...map.keys()].sort((a, b) => a - b) : []);
    });

    const common = [...(timestampSets[0] ?? [])].filter((ts) =>
      timestampSets.every((set) => set.has(ts)),
    );

    if (common.length < 10) {
      this.logger.warn(
        `Not enough overlapping bars (${common.length}); falling back to independent series`,
      );

      return symbols.map((symbol) => ({
        symbol,
        returns: this.toLogReturns([...(priceBySymbol.get(symbol)?.values() ?? [])]),
      }));
    }

    return symbols.map((symbol) => {
      const map = priceBySymbol.get(symbol)!;
      const prices = common.map((ts) => map.get(ts)!);
      return { symbol, returns: this.toLogReturns(prices) };
    });
  }

  async analyze(interval = '4h', lookbackDays = 30) {
    const cached = await this.redisService.getJson<any>(CACHE_KEY);
    if (cached && cached.interval === interval) return cached;

    const result = await this.buildMatrix(interval, lookbackDays);

    const snapshot = this.snapshotRepository.create({
      interval,
      benchmark: result.benchmark,
      symbolCount: result.symbols.length,
      symbols: result.symbols,
      matrix: result.matrix,
      clusters: result.clusters,
      averageCorrelation: Number(result.averageCorrelation.toFixed(4)),
    });

    const saved = await this.snapshotRepository.save(snapshot);

    await this.persistPairs(result);

    const payload = {
      id: saved.id,
      interval,
      benchmark: result.benchmark,
      symbols: result.symbols,
      matrix: result.matrix,
      clusters: result.clusters,
      averageCorrelation: Number(result.averageCorrelation.toFixed(4)),
      observations: result.observations,
      timestamp: saved.createdAt,
    };

    await this.redisService.setJson(CACHE_KEY, payload, CACHE_TTL);

    return payload;
  }

  /**
   * Stores the benchmark correlation per symbol and reports rotation when
   * the smoothed value moves meaningfully since the previous run.
   */
  private async persistPairs(matrixResult: {
    symbols: string[];
    matrix: number[][];
    benchmark: string;
  }): Promise<void> {
    const { symbols, matrix, benchmark } = matrixResult;

    if (!symbols.length) return;

    const benchIndex = symbols.indexOf(benchmark);

    for (let i = 0; i < symbols.length; i++) {
      if (i === benchIndex) continue;

      const correlation = matrix[benchIndex][i];
      if (!Number.isFinite(correlation)) continue;

      const existing = await this.pairRepository.findOne({
        where: { symbol: symbols[i], benchmark },
      });

      if (!existing) {
        await this.pairRepository.save(
          this.pairRepository.create({
            symbol: symbols[i],
            benchmark,
            interval: '4h',
            correlation: Number(correlation.toFixed(4)),
            smoothedCorrelation: Number(correlation.toFixed(4)),
            previousSmoothed: Number(correlation.toFixed(4)),
            observations: 1,
            regime: this.classify(correlation),
          }),
        );
        continue;
      }

      const previous = parseFloat(String(existing.smoothedCorrelation));
      const current = parseFloat(String(existing.correlation));
      const smoothed = previous * 0.6 + current * 0.4;
      const delta = smoothed - previous;

      existing.correlation = Number(current.toFixed(4));
      existing.previousSmoothed = previous;
      existing.smoothedCorrelation = Number(smoothed.toFixed(4));
      existing.observations += 1;
      existing.regime = this.classify(current);

      await this.pairRepository.save(existing);

      // Rotation: correlation decoupled from the benchmark.
      if (previous >= 0.75 && delta <= -0.12) {
        this.notificationGateway.sendCorrelationAlert({
          symbol: symbols[i],
          benchmark,
          correlation: Number(current.toFixed(3)),
          previous: Number(previous.toFixed(3)),
          direction: 'DECOUPLED',
        });

        this.logger.log(
          `Rotation signal: ${symbols[i]} correlation with ${benchmark} fell ${previous.toFixed(2)} -> ${current.toFixed(2)}`,
        );
      }
    }
  }

  /**
   * Per-symbol verdicts for the frontend: concentration risk, opportunity
   * to diversify, and any active rotation signal.
   */
  async getInsights(interval = '4h', lookbackDays = 30) {
    const data = await this.analyze(interval, lookbackDays);
    const benchIndex = data.symbols.indexOf(data.benchmark);

    const pairs = await this.pairRepository.find({
      where: { benchmark: data.benchmark },
      order: { correlation: 'DESC' },
    });

    const pairBySymbol = new Map(pairs.map((p) => [p.symbol, p]));

    const insights = data.symbols
      .filter((_, i) => i !== benchIndex)
      .map((symbol) => {
        const i = data.symbols.indexOf(symbol);
        const correlation = data.matrix[benchIndex][i];
        const pair = pairBySymbol.get(symbol);

        const smoothed = pair ? parseFloat(String(pair.smoothedCorrelation)) : correlation;
        const previous = pair ? parseFloat(String(pair.previousSmoothed)) : correlation;

        return {
          symbol,
          correlation: Number(correlation.toFixed(4)),
          smoothedCorrelation: Number(smoothed.toFixed(4)),
          previousCorrelation: Number(previous.toFixed(4)),
          delta: Number((smoothed - previous).toFixed(4)),
          regime: this.classify(correlation),
          rotation:
            previous >= 0.75 && smoothed - previous <= -0.12
              ? 'DECOUPLING'
              : previous <= 0.35 && smoothed - previous >= 0.12
                ? 'COUPLING'
                : 'STABLE',
        };
      })
      .sort((a, b) => b.correlation - a.correlation);

    const highRisk = insights.filter((i) => i.correlation >= 0.85);
    const opportunities = insights.filter((i) => i.correlation <= 0.2);
    const rotations = insights.filter((i) => i.rotation !== 'STABLE');

    const riskLevel = this.riskLevel(highRisk.length, insights.length);

    return {
      benchmark: data.benchmark,
      averageCorrelation: data.averageCorrelation,
      insights,
      concentrationRisk: {
        level: riskLevel,
        symbols: highRisk.map((i) => i.symbol),
        message: this.buildRiskMessage(riskLevel, highRisk.length, insights.length, data.benchmark),
      },
      diversificationOpportunity: {
        level: opportunities.length > 0 ? 'HIGH' : 'LOW',
        symbols: opportunities.slice(0, 8).map((i) => i.symbol),
        message:
          opportunities.length > 0
            ? `${opportunities.slice(0, 8).map((i) => i.symbol).join(', ')} trade largely independently of ${data.benchmark}.`
            : 'Every tracked asset is currently moving with the market.',
      },
      rotation: {
        active: rotations.length > 0,
        signals: rotations,
        message:
          rotations.length > 0
            ? `${rotations.length} asset(s) are changing their relationship to ${data.benchmark}.`
            : 'No correlation rotation detected right now.',
      },
    };
  }

  /**
   * Keeps the wording in step with the graded level so a LOW verdict
   * never ships with a warning-sounding message.
   */
  private buildRiskMessage(
    level: string,
    highRiskCount: number,
    total: number,
    benchmark: string,
  ): string {
    if (total === 0) {
      return 'No assets are being tracked yet.';
    }

    if (level === 'LOW') {
      return highRiskCount === 0
        ? `No asset is tightly locked to ${benchmark}; the set is reasonably diversified.`
        : `Only ${highRiskCount} of ${total} assets move almost identically to ${benchmark}, so concentration risk stays low.`;
    }

    if (level === 'MEDIUM') {
      return `${highRiskCount} of ${total} assets move almost identically to ${benchmark}. Owning several of them concentrates risk more than it looks.`;
    }

    return `${highRiskCount} of ${total} assets move almost identically to ${benchmark}. Holding them together barely diversifies risk, because one move in ${benchmark} moves them all.`;
  }

  private riskLevel(count: number, total: number): string {
    if (total === 0) return 'LOW';
    const share = count / total;
    if (share >= 0.5) return 'CRITICAL';
    if (share >= 0.3) return 'HIGH';
    if (share >= 0.15) return 'MEDIUM';
    return 'LOW';
  }

  async getLatest() {
    const cached = await this.redisService.getJson<any>(CACHE_KEY);
    if (cached) return cached;

    const latest = await this.snapshotRepository.findOne({
      order: { createdAt: 'DESC' },
    });

    if (!latest) return null;

    return {
      id: latest.id,
      interval: latest.interval,
      benchmark: latest.benchmark,
      symbols: latest.symbols,
      matrix: latest.matrix,
      clusters: latest.clusters,
      averageCorrelation: parseFloat(String(latest.averageCorrelation)),
      observations: 0,
      timestamp: latest.createdAt,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledAnalysis() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.redisService.del(CACHE_KEY);
      await this.analyze('4h', 30);
    } catch (error) {
      this.logger.error(
        `Scheduled correlation analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}