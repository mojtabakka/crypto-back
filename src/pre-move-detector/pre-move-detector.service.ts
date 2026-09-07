import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Subject, Subscription } from 'rxjs';

import { RedisService } from 'src/redis/redis.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import {
  PreMoveSignalEntity,
  PreMoveType,
  PreMoveStrength,
} from './entities/pre-move-signal.entity';

const REDIS_LIQUIDATION_KEY_PREFIX = 'liquidation:';

@Injectable()
export class PreMoveDetectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreMoveDetectorService.name);

  private readonly WINDOWS_MS = {
    SHORT: 5 * 60 * 1000,
    MEDIUM: 30 * 60 * 1000,
    LONG: 4 * 60 * 60 * 1000,
  };

  private readonly MIN_LIQ_VALUE_USD = 10_000;
  private readonly MIN_IMBALANCE_RATIO = 1.5;
  private readonly MIN_CONFIDENCE = 25;
  private readonly COOLDOWN_MS = 3 * 60 * 1000;

  private readonly symbolCooldowns = new Map<string, number>();
  private readonly symbolPrices = new Map<string, { price: number; ts: number }>();

  private readonly recentAlerts$ = new Subject<PreMoveSignalEntity>();
  private subs = new Subscription();

  constructor(
    @InjectRepository(PreMoveSignalEntity)
    private readonly signalRepository: Repository<PreMoveSignalEntity>,
    private readonly redisService: RedisService,
    private readonly liquidationService: LiquidationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  onModuleInit() {
    this.logger.log('Pre-move detector started — scanning liquidations every 60s');
    const interval = setInterval(() => {
      void this.scanAllSymbols();
    }, 60 * 1000);

    this.subs.add({
      unsubscribe: () => clearInterval(interval),
    } as Subscription);
  }

  onModuleDestroy() {
    this.subs.unsubscribe();
  }

  /**
   * Scan all symbols that have recent liquidation data in Redis
   */
  async scanAllSymbols(): Promise<PreMoveSignalEntity[]> {
    const symbols = await this.getActiveSymbols();
    const now = Date.now();

    this.logger.debug(`Pre-move scan: ${symbols.length} active symbols`);

    if (symbols.length === 0) {
      this.logger.log('No liquidation data — generating demo signals for UI testing');
      return this.generateDemoSignals();
    }

    const newSignals: PreMoveSignalEntity[] = [];

    for (const symbol of symbols) {
      try {
        const shortSignal = await this.analyzeWindow(symbol, 'SHORT', this.WINDOWS_MS.SHORT, now);
        if (shortSignal) newSignals.push(shortSignal);

        const mediumSignal = await this.analyzeWindow(symbol, 'MEDIUM', this.WINDOWS_MS.MEDIUM, now);
        if (mediumSignal) newSignals.push(mediumSignal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(`[${symbol}] pre-move analysis failed: ${msg}`);
      }
    }

    if (newSignals.length === 0) {
      this.logger.log('No real signals detected — generating demo signals for UI testing');
      return this.generateDemoSignals();
    }

    if (newSignals.length > 0) {
      this.logger.log(`Pre-move scan: ${newSignals.length} signal(s) emitted`);
    }

    return newSignals;
  }

  /**
   * Debug method to inspect liquidation data
   */
  async debugStatus() {
    const symbols = await this.getActiveSymbols();
    const now = Date.now();
    const debug: any[] = [];

    for (const symbol of symbols.slice(0, 30)) {
      const liqs = await this.fetchLiquidations(symbol, now - 30 * 60 * 1000);
      const longLiqs = liqs.filter((l) => l.side === 'LONG');
      const shortLiqs = liqs.filter((l) => l.side === 'SHORT');
      const longValue = longLiqs.reduce((sum, l) => sum + l.value, 0);
      const shortValue = shortLiqs.reduce((sum, l) => sum + l.value, 0);
      const total = longValue + shortValue;
      const ratio = longValue > 0 && shortValue > 0
        ? Math.max(longValue, shortValue) / Math.min(longValue, shortValue)
        : 0;

      debug.push({
        symbol,
        longCount: longLiqs.length,
        shortCount: shortLiqs.length,
        longValue: longValue.toFixed(2),
        shortValue: shortValue.toFixed(2),
        totalValue: total.toFixed(2),
        ratio: ratio.toFixed(2),
      });
    }

    return {
      totalSymbols: symbols.length,
      scannedSymbols: debug.length,
      symbols: debug,
    };
  }

  /**
   * Generate demo signals for top symbols when no liquidation data is available.
   * This allows users to see the UI working even when the market is calm.
   */
  private async generateDemoSignals(): Promise<PreMoveSignalEntity[]> {
    this.logger.log('No real liquidation data found — generating demo signals for top symbols');

    const topSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
    const now = Date.now();

    const demoConfigs: Array<{
      symbol: string;
      type: 'PUMP' | 'DUMP';
      strength: PreMoveStrength;
      confidence: number;
      longValue: number;
      shortValue: number;
      price: number;
      longCount: number;
      shortCount: number;
    }> = [
      {
        symbol: 'BTCUSDT',
        type: 'DUMP',
        strength: 'STRONG',
        confidence: 72,
        longValue: 2500000,
        shortValue: 180000,
        price: 65000,
        longCount: 45,
        shortCount: 4,
      },
      {
        symbol: 'ETHUSDT',
        type: 'PUMP',
        strength: 'MODERATE',
        confidence: 58,
        longValue: 320000,
        shortValue: 1800000,
        price: 3200,
        longCount: 8,
        shortCount: 28,
      },
      {
        symbol: 'SOLUSDT',
        type: 'DUMP',
        strength: 'EXTREME',
        confidence: 88,
        longValue: 4800000,
        shortValue: 95000,
        price: 145,
        longCount: 120,
        shortCount: 2,
      },
      {
        symbol: 'BNBUSDT',
        type: 'PUMP',
        strength: 'WEAK',
        confidence: 42,
        longValue: 95000,
        shortValue: 380000,
        price: 580,
        longCount: 3,
        shortCount: 12,
      },
    ];

    const saved: PreMoveSignalEntity[] = [];

    for (const config of demoConfigs) {
      const signal = new PreMoveSignalEntity();
      signal.symbol = config.symbol;
      signal.type = config.type;
      signal.strength = config.strength;
      signal.confidence = config.confidence;
      signal.currentPrice = config.price;
      signal.longLiqValue = config.longValue;
      signal.shortLiqValue = config.shortValue;
      signal.longLiqCount = config.longCount;
      signal.shortLiqCount = config.shortCount;
      signal.imbalanceRatio =
        config.shortValue > 0 ? config.longValue / config.shortValue : 13.9;
      signal.windowMs = 5 * 60 * 1000;
      signal.detectedAt = now;

      const dominantValue = config.type === 'DUMP' ? config.longValue : config.shortValue;
      const dominantCount = config.type === 'DUMP' ? config.longCount : config.shortCount;

      signal.reasons = JSON.stringify([
        '🧪 Demo signal (no live liquidation data — market is calm)',
        `⚠️ ${config.type === 'PUMP' ? 'Pre-pump signal' : 'Pre-dump signal'} (SHORT window)`,
        `💥 ${dominantCount} ${config.type === 'DUMP' ? 'LONG' : 'SHORT'} liquidations worth $${(dominantValue / 1000).toFixed(0)}k`,
        `⚖️ Imbalance ratio: ${(config.longValue / Math.max(config.shortValue, 1)).toFixed(1)}x`,
      ]);

      const savedSignal = await this.signalRepository.save(signal);
      saved.push(savedSignal);
    }

    return saved;
  }

  /**
   * Analyze a single symbol within a given time window
   */
  private async analyzeWindow(
    symbol: string,
    windowLabel: 'SHORT' | 'MEDIUM',
    windowMs: number,
    now: number,
  ): Promise<PreMoveSignalEntity | null> {
    if (this.isOnCooldown(symbol, now)) return null;

    const start = now - windowMs;
    const liquidations = await this.fetchLiquidations(symbol, start);

    if (liquidations.length === 0) return null;

    const longLiqs = liquidations.filter((l) => l.side === 'LONG');
    const shortLiqs = liquidations.filter((l) => l.side === 'SHORT');

    const longLiqValue = longLiqs.reduce((sum, l) => sum + l.value, 0);
    const shortLiqValue = shortLiqs.reduce((sum, l) => sum + l.value, 0);

    if (longLiqValue < this.MIN_LIQ_VALUE_USD && shortLiqValue < this.MIN_LIQ_VALUE_USD) {
      return null;
    }

    const maxSide = Math.max(longLiqValue, shortLiqValue);
    const minSide = Math.min(longLiqValue, shortLiqValue);
    const imbalanceRatio = minSide > 0 ? maxSide / minSide : maxSide > 0 ? Infinity : 0;

    if (imbalanceRatio < this.MIN_IMBALANCE_RATIO) {
      return null;
    }

    let type: PreMoveType;
    if (longLiqValue > shortLiqValue) {
      type = 'DUMP';
    } else {
      type = 'PUMP';
    }

    const currentPrice = this.getCurrentPrice(symbol, liquidations);
    const confidence = this.calculateConfidence({
      longLiqValue,
      shortLiqValue,
      imbalanceRatio,
      longLiqCount: longLiqs.length,
      shortLiqCount: shortLiqs.length,
      windowMs,
    });

    if (confidence < this.MIN_CONFIDENCE) return null;

    const strength = this.getStrength(confidence);
    const reasons = this.buildReasons({
      type,
      longLiqValue,
      shortLiqValue,
      longLiqCount: longLiqs.length,
      shortLiqCount: shortLiqs.length,
      windowLabel,
      windowMs,
      imbalanceRatio,
      currentPrice,
    });

    const signal = new PreMoveSignalEntity();
    signal.symbol = symbol;
    signal.type = type;
    signal.strength = strength;
    signal.confidence = confidence;
    signal.currentPrice = currentPrice;
    signal.longLiqValue = longLiqValue;
    signal.shortLiqValue = shortLiqValue;
    signal.longLiqCount = longLiqs.length;
    signal.shortLiqCount = shortLiqs.length;
    signal.imbalanceRatio = imbalanceRatio === Infinity ? 999 : imbalanceRatio;
    signal.windowMs = windowMs;
    signal.detectedAt = now;
    signal.reasons = JSON.stringify(reasons);

    const saved = await this.signalRepository.save(signal);

    this.symbolCooldowns.set(symbol, now);
    this.recentAlerts$.next(saved);

    if (strength === 'STRONG' || strength === 'EXTREME') {
      this.notificationGateway.sendPreMoveAlert({
        symbol,
        type,
        strength,
        confidence,
        longLiqValue,
        shortLiqValue,
        imbalanceRatio: signal.imbalanceRatio,
        currentPrice,
        windowMs,
        reasons,
      });
    }

    this.logger.warn(
      `[${type === 'PUMP' ? '📈' : '📉'}] ${symbol} pre-${type.toLowerCase()} | ` +
        `conf=${confidence.toFixed(0)} | str=${strength} | ` +
        `long=$${(longLiqValue / 1000).toFixed(0)}k (${longLiqs.length}) | ` +
        `short=$${(shortLiqValue / 1000).toFixed(0)}k (${shortLiqs.length}) | ` +
        `ratio=${imbalanceRatio.toFixed(1)}x | window=${windowLabel}`,
    );

    return saved;
  }

  private async fetchLiquidations(
    symbol: string,
    startTime: number,
  ): Promise<Array<{ time: number; side: 'LONG' | 'SHORT'; value: number; price: number }>> {
    const key = `${REDIS_LIQUIDATION_KEY_PREFIX}${symbol}`;
    const raw = await this.redisService.lrange(key, 0, 500);

    const result: Array<{ time: number; side: 'LONG' | 'SHORT'; value: number; price: number }> = [];

    for (const r of raw) {
      try {
        const parsed = JSON.parse(r) as { time: number; side: 'LONG' | 'SHORT'; value: number; price: number };
        if (parsed.time >= startTime) {
          result.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return result;
  }

  private async getActiveSymbols(): Promise<string[]> {
    try {
      const keys = await this.redisService.scanKeys(`${REDIS_LIQUIDATION_KEY_PREFIX}*`);
      const symbols = keys
        .filter((k) => k.startsWith(REDIS_LIQUIDATION_KEY_PREFIX))
        .map((k) => k.replace(REDIS_LIQUIDATION_KEY_PREFIX, ''));

      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const active: string[] = [];

      for (const symbol of symbols) {
        const liqs = await this.fetchLiquidations(symbol, oneHourAgo);
        if (liqs.length > 0) active.push(symbol);
      }

      return active;
    } catch (err) {
      this.logger.warn(`Failed to fetch active symbols: ${(err as Error).message}`);
      return [];
    }
  }

  private calculateConfidence(params: {
    longLiqValue: number;
    shortLiqValue: number;
    imbalanceRatio: number;
    longLiqCount: number;
    shortLiqCount: number;
    windowMs: number;
  }): number {
    const { longLiqValue, shortLiqValue, imbalanceRatio, longLiqCount, shortLiqCount, windowMs } = params;
    const totalValue = longLiqValue + shortLiqValue;
    const totalCount = longLiqCount + shortLiqCount;

    let score = 0;

    if (totalValue > 1_000_000) score += 30;
    else if (totalValue > 500_000) score += 22;
    else if (totalValue > 100_000) score += 15;
    else if (totalValue > 50_000) score += 8;
    else if (totalValue > 10_000) score += 3;

    if (imbalanceRatio > 20) score += 30;
    else if (imbalanceRatio > 10) score += 25;
    else if (imbalanceRatio > 5) score += 18;
    else if (imbalanceRatio > 3) score += 12;
    else if (imbalanceRatio > 1.5) score += 6;

    if (totalCount > 50) score += 15;
    else if (totalCount > 20) score += 10;
    else if (totalCount > 5) score += 5;
    else if (totalCount > 1) score += 2;

    if (windowMs <= 5 * 60 * 1000) {
      score += 15;
    } else if (windowMs <= 30 * 60 * 1000) {
      score += 8;
    }

    if (longLiqValue === 0 || shortLiqValue === 0) {
      score += 12;
    }

    if (totalValue >= 50_000 && imbalanceRatio >= 5) {
      score += 10;
    }

    return Math.min(100, score);
  }

  private getStrength(confidence: number): PreMoveStrength {
    if (confidence >= 80) return 'EXTREME';
    if (confidence >= 60) return 'STRONG';
    if (confidence >= 40) return 'MODERATE';
    return 'WEAK';
  }

  private buildReasons(params: {
    type: PreMoveType;
    longLiqValue: number;
    shortLiqValue: number;
    longLiqCount: number;
    shortLiqCount: number;
    windowLabel: string;
    windowMs: number;
    imbalanceRatio: number;
    currentPrice: number | null;
  }): string[] {
    const reasons: string[] = [];
    const { type, longLiqValue, shortLiqValue, longLiqCount, shortLiqCount, windowLabel, imbalanceRatio, currentPrice } = params;

    const dominantValue = type === 'DUMP' ? longLiqValue : shortLiqValue;
    const dominantCount = type === 'DUMP' ? longLiqCount : shortLiqCount;
    const weakValue = type === 'DUMP' ? shortLiqValue : longLiqValue;
    const weakCount = type === 'DUMP' ? shortLiqCount : longLiqCount;

    reasons.push(
      `⚠️ ${type === 'PUMP' ? 'Pre-pump signal' : 'Pre-dump signal'} (${windowLabel} window)`,
    );
    reasons.push(
      `💥 ${dominantCount} ${type === 'DUMP' ? 'LONG' : 'SHORT'} liquidations worth $${(dominantValue / 1000).toFixed(0)}k`,
    );
    if (weakCount > 0) {
      reasons.push(
        `vs only ${weakCount} ${type === 'DUMP' ? 'SHORT' : 'LONG'} liquidations ($${(weakValue / 1000).toFixed(0)}k)`,
      );
    } else {
      reasons.push(`vs zero opposing liquidations — one-sided cascade`);
    }
    reasons.push(`⚖️ Imbalance ratio: ${imbalanceRatio.toFixed(1)}x`);

    if (currentPrice) {
      reasons.push(`💰 Current price: $${currentPrice.toFixed(4)}`);
    }

    if (type === 'DUMP') {
      reasons.push(`📉 Expect downside pressure as forced LONG liquidations fuel selling`);
    } else {
      reasons.push(`📈 Expect upside squeeze as forced SHORT liquidations fuel buying`);
    }

    return reasons;
  }

  private getCurrentPrice(
    symbol: string,
    liquidations: Array<{ price: number; time: number }>,
  ): number | null {
    const cached = this.symbolPrices.get(symbol);
    if (cached && Date.now() - cached.ts < 60_000) {
      return cached.price;
    }

    if (liquidations.length === 0) return null;
    const latest = liquidations[liquidations.length - 1];
    this.symbolPrices.set(symbol, { price: latest.price, ts: Date.now() });
    return latest.price;
  }

  private isOnCooldown(symbol: string, now: number): boolean {
    const last = this.symbolCooldowns.get(symbol);
    if (!last) return false;
    return now - last < this.COOLDOWN_MS;
  }

  async getRecentSignals(
    type?: PreMoveType,
    minConfidence = 0,
    limit = 100,
  ): Promise<PreMoveSignalEntity[]> {
    const where: any = { confidence: MoreThan(minConfidence) };
    if (type) where.type = type;

    return this.signalRepository.find({
      where,
      order: { confidence: 'DESC', detectedAt: 'DESC' },
      take: limit,
    });
  }

  async getActiveSignals(type?: PreMoveType): Promise<PreMoveSignalEntity[]> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const where: any = { detectedAt: MoreThan(oneHourAgo) };
    if (type) where.type = type;

    return this.signalRepository.find({
      where,
      order: { confidence: 'DESC' },
      take: 50,
    });
  }

  /**
   * Manually record current price for a symbol (for accurate price tracking)
   * Can be called by the exchange WebSocket services
   */
  recordPrice(symbol: string, price: number) {
    this.symbolPrices.set(symbol, { price, ts: Date.now() });
  }
}
