import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';

import { KlineEntity } from './entities/kline.entity';
import { BinanceKline } from 'src/market/dto/binance-kline.type';

@Injectable()
export class KlineService {
  private readonly logger = new Logger(KlineService.name);

  constructor(
    @InjectRepository(KlineEntity)
    private readonly klineRepository: Repository<KlineEntity>,
  ) {}

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceKline[]> {
    const klines = await this.klineRepository.find({
      where: {
        symbol,
        interval,
        openTime: Between(startTime, endTime),
      },
      order: { openTime: 'ASC' },
    });

    return klines.map((k) => [
      k.openTime,
      k.open,
      k.high,
      k.low,
      k.close,
      k.volume,
      k.closeTime,
      k.quoteVolume,
      k.trades,
      k.takerBuyBaseVolume,
      k.takerBuyQuoteVolume,
      '0',
    ]);
  }

  async getLatestOpenTime(
    symbol: string,
    interval: string,
  ): Promise<number | null> {
    const latest = await this.klineRepository.findOne({
      where: { symbol, interval },
      order: { openTime: 'DESC' },
    });
    return latest ? latest.openTime : null;
  }

  async getOldestOpenTime(
    symbol: string,
    interval: string,
  ): Promise<number | null> {
    const oldest = await this.klineRepository.findOne({
      where: { symbol, interval },
      order: { openTime: 'ASC' },
    });
    return oldest ? oldest.openTime : null;
  }

  async saveKlines(
    symbol: string,
    interval: string,
    klines: BinanceKline[],
  ): Promise<void> {
    if (klines.length === 0) return;

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

  async getMissingRanges(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
  ): Promise<Array<{ start: number; end: number }>> {
    const latestInDb = await this.getLatestOpenTime(symbol, interval);
    const oldestInDb = await this.getOldestOpenTime(symbol, interval);

    const ranges: Array<{ start: number; end: number }> = [];

    if (!latestInDb || !oldestInDb) {
      ranges.push({ start: startTime, end: endTime });
      return ranges;
    }

    if (startTime < oldestInDb) {
      ranges.push({ start: startTime, end: oldestInDb - 1 });
    }

    if (endTime > latestInDb) {
      ranges.push({ start: latestInDb + 1, end: endTime });
    }

    return ranges;
  }
}
