import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { VolumeProfileEntity } from './entities/volume-profile.entity';
import { KlineEntity } from 'src/kline/entities/kline.entity';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import { NotificationGateway } from 'src/notification/notification.gateway';

@Injectable()
export class VolumeProfileScannerService {
  private readonly logger = new Logger(VolumeProfileScannerService.name);

  constructor(
    @InjectRepository(VolumeProfileEntity)
    private readonly volumeProfileRepository: Repository<VolumeProfileEntity>,
    @InjectRepository(KlineEntity)
    private readonly klineRepository: Repository<KlineEntity>,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly exchangeService: ExchangeService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async scanAllSymbols(limit = 100): Promise<VolumeProfileEntity[]> {
    const startTime = Date.now();
    this.logger.log('Starting volume profile scan for all symbols...');

    try {
      const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
      const symbols = symbolsData.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .slice(0, limit)
        .map((s) => s.symbol);

      this.logger.log(
        `Scanning ${symbols.length} symbols for volume profile...`,
      );

      const results: VolumeProfileEntity[] = [];
      const intervals = ['1h', '4h'];

      let processedCount = 0;
      for (const symbol of symbols) {
        for (const interval of intervals) {
          try {
            const existingKlines = await this.klineRepository.find({
              where: { symbol, interval },
              order: { openTime: 'DESC' },
              take: 100,
            });

            if (existingKlines.length < 20) {
              const endTime = Date.now();
              const startTimeMs = endTime - this.getIntervalMs(interval) * 100;

              const fetchedKlines = await this.exchangeService.getFuturesKlines(
                symbol,
                interval,
                startTimeMs,
                endTime,
              );

              if (fetchedKlines.length > 0) {
                await this.saveKlinesToDb(symbol, interval, fetchedKlines);
              }
            }

            const klines = await this.klineRepository.find({
              where: { symbol, interval },
              order: { openTime: 'DESC' },
              take: 100,
            });

            if (klines.length >= 5) {
              const profile = this.calculateVolumeProfile(
                symbol,
                interval,
                klines,
              );
              if (profile.signal !== 'NEUTRAL') {
                const saved = await this.saveVolumeProfile(profile);
                results.push(saved);
              }
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown';
            this.logger.debug(`Failed ${symbol} ${interval}: ${errorMsg}`);
          }
        }

        processedCount++;
        if (processedCount % 10 === 0) {
          this.notificationGateway.sendScanProgress({
            current: processedCount,
            total: symbols.length,
            symbol,
            scanType: 'volume-profile',
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Volume profile scan complete: ${results.length} signals in ${duration}ms`,
      );

      return results;
    } catch (error) {
      this.logger.error('Volume profile scan failed', error);
      return [];
    }
  }

  private calculateVolumeProfile(
    symbol: string,
    interval: string,
    klines: KlineEntity[],
  ): VolumeProfileEntity {
    const volumeNodes = this.buildVolumeNodes(klines);
    const poc = this.calculatePOC(volumeNodes);
    const { vah, val } = this.calculateValueArea(volumeNodes);
    const currentPrice = parseFloat(klines[0].close);

    const signal = this.generateSignal(
      currentPrice,
      poc,
      vah,
      val,
      volumeNodes,
    );

    const entity = new VolumeProfileEntity();
    entity.symbol = symbol;
    entity.interval = interval;
    entity.timestamp = Date.now();
    entity.poc = poc.toString();
    entity.vah = vah.toString();
    entity.val = val.toString();
    entity.currentPrice = currentPrice.toString();
    entity.signal = signal.signal;
    entity.entryPrice = signal.entryPrice?.toString() || null;
    entity.stopLoss = signal.stopLoss?.toString() || null;
    entity.takeProfit = signal.takeProfit?.toString() || null;
    entity.riskRewardRatio = signal.riskRewardRatio?.toString() || null;
    entity.totalVolNodes = volumeNodes.length;

    return entity;
  }

  private buildVolumeNodes(
    klines: KlineEntity[],
  ): Array<{ price: number; volume: number }> {
    const priceVolumeMap = new Map<number, number>();

    for (const kline of klines) {
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const volume = parseFloat(kline.volume);

      const numBins = 20;
      const binSize = (high - low) / numBins || 0.001;

      for (let i = 0; i < numBins; i++) {
        const priceLevel = low + binSize * (i + 0.5);
        const roundedPrice = Math.round(priceLevel * 100) / 100;
        const existingVolume = priceVolumeMap.get(roundedPrice) || 0;
        priceVolumeMap.set(roundedPrice, existingVolume + volume / numBins);
      }
    }

    return Array.from(priceVolumeMap.entries())
      .map(([price, volume]) => ({ price, volume }))
      .sort((a, b) => a.price - b.price);
  }

  private calculatePOC(
    volumeNodes: Array<{ price: number; volume: number }>,
  ): number {
    let maxVolume = 0;
    let poc = 0;
    for (const node of volumeNodes) {
      if (node.volume > maxVolume) {
        maxVolume = node.volume;
        poc = node.price;
      }
    }
    return poc;
  }

  private calculateValueArea(
    volumeNodes: Array<{ price: number; volume: number }>,
  ): { vah: number; val: number } {
    if (volumeNodes.length === 0) return { vah: 0, val: 0 };

    const totalVolume = volumeNodes.reduce((sum, node) => sum + node.volume, 0);
    const targetVolume = totalVolume * 0.7;

    const pocVolume = Math.max(...volumeNodes.map((n) => n.volume));
    const pocIndex = volumeNodes.findIndex((n) => n.volume === pocVolume);

    let currentVolume = volumeNodes[pocIndex]?.volume || 0;
    let vahIndex = pocIndex;
    let valIndex = pocIndex;

    while (
      currentVolume < targetVolume &&
      (vahIndex < volumeNodes.length - 1 || valIndex > 0)
    ) {
      const nextVahVolume =
        vahIndex < volumeNodes.length - 1
          ? volumeNodes[vahIndex + 1].volume
          : 0;
      const nextValVolume = valIndex > 0 ? volumeNodes[valIndex - 1].volume : 0;

      if (nextVahVolume >= nextValVolume && vahIndex < volumeNodes.length - 1) {
        vahIndex++;
        currentVolume += nextVahVolume;
      } else if (valIndex > 0) {
        valIndex--;
        currentVolume += nextValVolume;
      } else {
        break;
      }
    }

    return {
      vah: volumeNodes[vahIndex]?.price || 0,
      val: volumeNodes[valIndex]?.price || 0,
    };
  }

  private generateSignal(
    currentPrice: number,
    poc: number,
    vah: number,
    val: number,
    volumeNodes: Array<{ price: number; volume: number }>,
  ): {
    signal: 'LONG' | 'SHORT' | 'NEUTRAL';
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    riskRewardRatio: number | null;
  } {
    if (vah === val || vah === 0 || val === 0) {
      return {
        signal: 'NEUTRAL',
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        riskRewardRatio: null,
      };
    }

    const atr = this.calculateATR(volumeNodes);

    if (currentPrice > vah) {
      const entryPrice = vah;
      const stopLoss = val;
      const risk = entryPrice - stopLoss;
      if (risk > 0 && risk < entryPrice * 0.2) {
        const takeProfit = entryPrice + risk * 2;
        return {
          signal: 'LONG',
          entryPrice: this.roundToTick(entryPrice),
          stopLoss: this.roundToTick(stopLoss),
          takeProfit: this.roundToTick(takeProfit),
          riskRewardRatio: (takeProfit - entryPrice) / risk,
        };
      }
    }

    if (currentPrice < val) {
      const entryPrice = val;
      const stopLoss = vah;
      const risk = stopLoss - entryPrice;
      if (risk > 0 && risk < entryPrice * 0.2) {
        const takeProfit = entryPrice - risk * 2;
        return {
          signal: 'SHORT',
          entryPrice: this.roundToTick(entryPrice),
          stopLoss: this.roundToTick(stopLoss),
          takeProfit: this.roundToTick(takeProfit),
          riskRewardRatio: (entryPrice - takeProfit) / risk,
        };
      }
    }

    const distanceToVal = (currentPrice - val) / (vah - val);
    if (distanceToVal < 0.25) {
      const entryPrice = val;
      const stopLoss = val - atr;
      const takeProfit = poc > entryPrice ? poc : vah;
      const risk = entryPrice - stopLoss;
      const reward = takeProfit - entryPrice;
      if (risk > 0 && reward > risk * 1.5) {
        return {
          signal: 'LONG',
          entryPrice: this.roundToTick(entryPrice),
          stopLoss: this.roundToTick(stopLoss),
          takeProfit: this.roundToTick(takeProfit),
          riskRewardRatio: reward / risk,
        };
      }
    }

    if (distanceToVal > 0.75) {
      const entryPrice = vah;
      const stopLoss = vah + atr;
      const takeProfit = poc < entryPrice ? poc : val;
      const risk = stopLoss - entryPrice;
      const reward = entryPrice - takeProfit;
      if (risk > 0 && reward > risk * 1.5) {
        return {
          signal: 'SHORT',
          entryPrice: this.roundToTick(entryPrice),
          stopLoss: this.roundToTick(stopLoss),
          takeProfit: this.roundToTick(takeProfit),
          riskRewardRatio: reward / risk,
        };
      }
    }

    return {
      signal: 'NEUTRAL',
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
    };
  }

  private calculateATR(
    volumeNodes: Array<{ price: number; volume: number }>,
  ): number {
    if (volumeNodes.length < 2) return 0;
    let totalRange = 0;
    for (let i = 1; i < volumeNodes.length; i++) {
      totalRange += Math.abs(volumeNodes[i].price - volumeNodes[i - 1].price);
    }
    return totalRange / (volumeNodes.length - 1);
  }

  private roundToTick(price: number): number {
    if (price >= 10000) return Math.round(price * 100) / 100;
    if (price >= 1000) return Math.round(price * 100) / 100;
    if (price >= 100) return Math.round(price * 1000) / 1000;
    if (price >= 1) return Math.round(price * 10000) / 10000;
    return Math.round(price * 1000000) / 1000000;
  }

  private async saveKlinesToDb(
    symbol: string,
    interval: string,
    klines: Array<
      [
        number,
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        number,
        string,
        string,
        string,
      ]
    >,
  ): Promise<void> {
    const entities = klines.map((k) => {
      const entity = new KlineEntity();
      entity.symbol = symbol;
      entity.interval = interval;
      entity.openTime = k[0];
      entity.open = k[1];
      entity.high = k[2];
      entity.low = k[3];
      entity.close = k[4];
      entity.volume = k[5];
      entity.closeTime = k[6];
      entity.quoteVolume = k[7];
      entity.trades = k[8];
      entity.takerBuyBaseVolume = k[9];
      entity.takerBuyQuoteVolume = k[10];
      return entity;
    });

    await this.klineRepository.upsert(entities, [
      'symbol',
      'interval',
      'openTime',
    ]);
  }

  private async saveVolumeProfile(
    entity: VolumeProfileEntity,
  ): Promise<VolumeProfileEntity> {
    return this.volumeProfileRepository.save(entity);
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[interval] || 24 * 60 * 60 * 1000;
  }

  async getLatestSignals(interval?: string): Promise<VolumeProfileEntity[]> {
    const query = this.volumeProfileRepository
      .createQueryBuilder('vp')
      .where('vp.signal != :neutral', { neutral: 'NEUTRAL' })
      .orderBy('vp.createdAt', 'DESC')
      .take(50);

    if (interval) {
      query.andWhere('vp.interval = :interval', { interval });
    }

    return query.getMany();
  }
}
