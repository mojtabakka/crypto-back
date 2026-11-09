import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  VolumeProfileEntity,
  VolumeProfileSignal,
} from './entities/volume-profile.entity';
import { KlineEntity } from 'src/kline/entities/kline.entity';
import { ExchangeService } from 'src/exchange/exchange.service';
import { KlineService } from 'src/kline/kline.service';
import { Between } from 'typeorm';

export interface VolumeNode {
  price: number;
  volume: number;
}

export interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  currentPrice: number;
  signal: VolumeProfileSignal;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  totalVolNodes: number;
  volumeNodes: VolumeNode[];
}

@Injectable()
export class VolumeProfileService {
  private readonly logger = new Logger(VolumeProfileService.name);

  constructor(
    @InjectRepository(VolumeProfileEntity)
    private readonly volumeProfileRepository: Repository<VolumeProfileEntity>,
    @InjectRepository(KlineEntity)
    private readonly klineRepository: Repository<KlineEntity>,
    private readonly exchangeService: ExchangeService,
    private readonly klineService: KlineService,
  ) {}

  async calculateVolumeProfile(
    symbol: string,
    interval: string,
    lookback = 100,
  ): Promise<VolumeProfileResult> {
    let klines = await this.klineRepository.find({
      where: { symbol, interval },
      order: { openTime: 'DESC' },
      take: lookback,
    });

    if (klines.length === 0) {
      this.logger.log(
        `No cached kline data for ${symbol} ${interval}, fetching from exchange...`,
      );
      const endTime = Date.now();
      const startTime = endTime - this.getIntervalMs(interval) * lookback;

      try {
        const fetchedKlines = await this.exchangeService.getFuturesKlines(
          symbol,
          interval,
          startTime,
          endTime,
        );

        if (fetchedKlines.length === 0) {
          throw new Error(`No kline data available for ${symbol} ${interval}`);
        }

        await this.klineService.saveKlines(symbol, interval, fetchedKlines);

        klines = await this.klineRepository.find({
          where: { symbol, interval },
          order: { openTime: 'DESC' },
          take: lookback,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to fetch klines for ${symbol} ${interval}: ${errorMsg}`,
        );
        throw new Error(`Failed to fetch data for ${symbol}: ${errorMsg}`);
      }
    }

    if (klines.length === 0) {
      throw new Error(`No kline data available for ${symbol} ${interval}`);
    }

    const volumeNodes = this.buildVolumeNodes(klines);

    if (volumeNodes.length < 5) {
      return {
        poc: parseFloat(klines[0].close),
        vah: parseFloat(klines[0].close),
        val: parseFloat(klines[0].close),
        currentPrice: parseFloat(klines[0].close),
        signal: 'NEUTRAL',
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        riskRewardRatio: null,
        totalVolNodes: volumeNodes.length,
        volumeNodes,
      };
    }
    const poc = this.calculatePOC(volumeNodes);
    const { vah, val } = this.calculateValueArea(volumeNodes);
    const currentPrice = parseFloat(klines[0].close);

    if (vah === val || vah === 0 || val === 0) {
      return {
        poc,
        vah: currentPrice,
        val: currentPrice,
        currentPrice,
        signal: 'NEUTRAL',
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        riskRewardRatio: null,
        totalVolNodes: volumeNodes.length,
        volumeNodes,
      };
    }

    const { signal, entryPrice, stopLoss, takeProfit, riskRewardRatio } =
      this.generateSignal(currentPrice, poc, vah, val, volumeNodes);

    return {
      poc,
      vah,
      val,
      currentPrice,
      signal,
      entryPrice,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      totalVolNodes: volumeNodes.length,
      volumeNodes,
    };
  }

  private buildVolumeNodes(klines: KlineEntity[]): VolumeNode[] {
    const priceVolumeMap = new Map<number, number>();

    for (const kline of klines) {
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const volume = parseFloat(kline.volume);

      const numBins = 20;
      const binSize = (high - low) / numBins;

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

  private calculatePOC(volumeNodes: VolumeNode[]): number {
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

  private calculateValueArea(volumeNodes: VolumeNode[]): {
    vah: number;
    val: number;
  } {
    if (volumeNodes.length === 0) {
      return { vah: 0, val: 0 };
    }

    const totalVolume = volumeNodes.reduce((sum, node) => sum + node.volume, 0);
    const targetVolume = totalVolume * 0.7;

    const pocIndex = volumeNodes.findIndex(
      (node) => node.volume === Math.max(...volumeNodes.map((n) => n.volume)),
    );

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
    volumeNodes: VolumeNode[],
  ): {
    signal: VolumeProfileSignal;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    riskRewardRatio: number | null;
  } {
    const atr = this.calculateATR(volumeNodes);
    const avgVolume =
      volumeNodes.reduce((sum, n) => sum + n.volume, 0) / volumeNodes.length;
    const hvns = volumeNodes.filter((n) => n.volume > avgVolume * 1.5);
    const lvns = volumeNodes.filter((n) => n.volume < avgVolume * 0.5);

    if (currentPrice > vah) {
      const entryPrice = vah;
      const nearestHVNBelow = this.findNearestHVN(
        currentPrice,
        volumeNodes,
        'below',
      );
      const stopLoss = nearestHVNBelow ? nearestHVNBelow - atr : val;
      const risk = entryPrice - stopLoss;

      if (risk > 0 && risk < entryPrice * 0.2) {
        const takeProfit = entryPrice + risk * 2;

        if (takeProfit > entryPrice) {
          return {
            signal: 'LONG',
            entryPrice: this.roundToTick(entryPrice),
            stopLoss: this.roundToTick(stopLoss),
            takeProfit: this.roundToTick(takeProfit),
            riskRewardRatio: Math.abs(takeProfit - entryPrice) / risk,
          };
        }
      }
    }

    if (currentPrice < val) {
      const entryPrice = val;
      const nearestHVNAbove = this.findNearestHVN(
        currentPrice,
        volumeNodes,
        'above',
      );
      const stopLoss = nearestHVNAbove ? nearestHVNAbove + atr : vah;
      const risk = stopLoss - entryPrice;

      if (risk > 0 && risk < entryPrice * 0.2) {
        const takeProfit = entryPrice - risk * 2;

        if (takeProfit > 0 && takeProfit < entryPrice) {
          return {
            signal: 'SHORT',
            entryPrice: this.roundToTick(entryPrice),
            stopLoss: this.roundToTick(stopLoss),
            takeProfit: this.roundToTick(takeProfit),
            riskRewardRatio: Math.abs(entryPrice - takeProfit) / risk,
          };
        }
      }
    }

    if (currentPrice >= val && currentPrice <= vah) {
      const distanceToVal = (currentPrice - val) / (vah - val);

      if (distanceToVal < 0.25) {
        const entryPrice = val;
        const stopLoss =
          this.findLVNBelow(entryPrice, lvns) || entryPrice - atr * 1.5;
        const risk = entryPrice - stopLoss;
        const takeProfit = poc > entryPrice ? poc : vah;
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
        const stopLoss =
          this.findLVNAbove(entryPrice, lvns) || entryPrice + atr * 1.5;
        const risk = stopLoss - entryPrice;
        const takeProfit = poc < entryPrice ? poc : val;
        const reward = entryPrice - takeProfit;

        if (risk > 0 && reward > risk * 1.5 && takeProfit > 0) {
          return {
            signal: 'SHORT',
            entryPrice: this.roundToTick(entryPrice),
            stopLoss: this.roundToTick(stopLoss),
            takeProfit: this.roundToTick(takeProfit),
            riskRewardRatio: reward / risk,
          };
        }
      }

      if (distanceToVal >= 0.25 && distanceToVal <= 0.75) {
        const distanceToPoc = Math.abs(currentPrice - poc);
        const isAbovePoc = currentPrice > poc;

        if (isAbovePoc && distanceToPoc < (vah - val) * 0.2) {
          const entryPrice = poc;
          const stopLoss = val;
          const risk = entryPrice - stopLoss;
          const takeProfit = vah;
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

        if (!isAbovePoc && distanceToPoc < (vah - val) * 0.2) {
          const entryPrice = poc;
          const stopLoss = vah;
          const risk = stopLoss - entryPrice;
          const takeProfit = val;
          const reward = entryPrice - takeProfit;

          if (risk > 0 && reward > risk * 1.5 && takeProfit > 0) {
            return {
              signal: 'SHORT',
              entryPrice: this.roundToTick(entryPrice),
              stopLoss: this.roundToTick(stopLoss),
              takeProfit: this.roundToTick(takeProfit),
              riskRewardRatio: reward / risk,
            };
          }
        }
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

  private calculateATR(volumeNodes: VolumeNode[]): number {
    if (volumeNodes.length < 2) return 0;
    let totalRange = 0;
    for (let i = 1; i < volumeNodes.length; i++) {
      totalRange += Math.abs(volumeNodes[i].price - volumeNodes[i - 1].price);
    }
    return totalRange / (volumeNodes.length - 1);
  }

  private findLVNBelow(price: number, lvns: VolumeNode[]): number | null {
    const below = lvns
      .filter((n) => n.price < price)
      .sort((a, b) => b.price - a.price);
    return below[0]?.price || null;
  }

  private findLVNAbove(price: number, lvns: VolumeNode[]): number | null {
    const above = lvns
      .filter((n) => n.price > price)
      .sort((a, b) => a.price - b.price);
    return above[0]?.price || null;
  }

  private roundToTick(price: number): number {
    if (!Number.isFinite(price) || price === 0) return price;

    // Keep ~4 significant digits at every scale: sub-cent coins like SHIB
    // were flattened to 0.00 by fixed 2-decimal rounding.
    const magnitude = Math.floor(Math.log10(Math.abs(price)));
    const decimals = Math.min(10, Math.max(2, 4 - magnitude));

    return Number(price.toFixed(decimals));
  }

  private findNearestHVN(
    price: number,
    volumeNodes: VolumeNode[],
    direction: 'above' | 'below',
  ): number | null {
    const avgVolume =
      volumeNodes.reduce((sum, n) => sum + n.volume, 0) / volumeNodes.length;
    const hvns = volumeNodes.filter((n) => n.volume > avgVolume * 1.5);

    if (direction === 'below') {
      const below = hvns
        .filter((n) => n.price < price)
        .sort((a, b) => b.price - a.price);
      return below[0]?.price || null;
    } else {
      const above = hvns
        .filter((n) => n.price > price)
        .sort((a, b) => a.price - b.price);
      return above[0]?.price || null;
    }
  }

  async saveVolumeProfile(
    symbol: string,
    interval: string,
    result: VolumeProfileResult,
  ): Promise<VolumeProfileEntity> {
    const entity = new VolumeProfileEntity();
    entity.symbol = symbol;
    entity.interval = interval;
    entity.timestamp = Date.now();
    entity.poc = result.poc.toString();
    entity.vah = result.vah.toString();
    entity.val = result.val.toString();
    entity.currentPrice = result.currentPrice.toString();
    entity.signal = result.signal;
    entity.entryPrice = result.entryPrice?.toString() || null;
    entity.stopLoss = result.stopLoss?.toString() || null;
    entity.takeProfit = result.takeProfit?.toString() || null;
    entity.riskRewardRatio = result.riskRewardRatio?.toString() || null;
    entity.totalVolNodes = result.totalVolNodes;

    return this.volumeProfileRepository.save(entity);
  }

  async getLatestProfile(
    symbol: string,
    interval: string,
  ): Promise<VolumeProfileEntity | null> {
    return this.volumeProfileRepository.findOne({
      where: { symbol, interval },
      order: { createdAt: 'DESC' },
    });
  }

  async scanAllSymbols(
    interval: string,
    limit = 50,
  ): Promise<VolumeProfileEntity[]> {
    const latestProfiles = await this.volumeProfileRepository
      .createQueryBuilder('vp')
      .select('vp.symbol')
      .addSelect('MAX(vp.createdAt)', 'maxCreatedAt')
      .where('vp.interval = :interval', { interval })
      .groupBy('vp.symbol')
      .getRawMany();

    return latestProfiles.slice(0, limit).map((p) => p);
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
}
