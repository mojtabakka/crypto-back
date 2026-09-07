import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketScannerService } from 'src/market-scanner/market-scanner.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import {
  WeeklyEma21SignalEntity,
  Ema21Strength,
} from './entities/weekly-ema21-signal.entity';

@Injectable()
export class WeeklyEma21SignalService {
  private readonly logger = new Logger(WeeklyEma21SignalService.name);

  constructor(
    private readonly marketScannerService: MarketScannerService,
    private readonly notificationGateway: NotificationGateway,
    @InjectRepository(WeeklyEma21SignalEntity)
    private readonly signalRepository: Repository<WeeklyEma21SignalEntity>,
  ) {}

  @Cron('10 0 * * 1')
  async handleCron() {
    await this.scanAndStoreSignals('BINANCE');
  }

  private classifyStrength(priceVsEma21: number): Ema21Strength {
    if (priceVsEma21 < 5) return 'JUST_ABOVE';
    if (priceVsEma21 < 20) return 'ABOVE';
    if (priceVsEma21 < 50) return 'STRONG';
    return 'EXTREME';
  }

  async scanAndStoreSignals(exchange: string = 'BINANCE'): Promise<{
    count: number;
    duration: number;
  }> {
    const startTime = Date.now();
    this.logger.log(`Starting weekly EMA21 scan for ${exchange}...`);

    try {
      const result = await this.marketScannerService.scanForWeeklyAboveEma21(
        200,
        exchange,
      );

      const signals: WeeklyEma21SignalEntity[] = [];

      for (const item of result.symbols) {
        if (item.priceVsEma21 === null) continue;
        const entity = new WeeklyEma21SignalEntity();
        entity.symbol = item.symbol;
        entity.strength = this.classifyStrength(item.priceVsEma21);
        entity.priceVsEma21 = item.priceVsEma21;
        entity.currentPrice = item.currentPrice;
        entity.ema21 = item.ema21;
        entity.exchange = exchange;
        signals.push(entity);
      }

      await this.signalRepository
        .createQueryBuilder()
        .delete()
        .where('exchange = :exchange', { exchange })
        .execute();

      if (signals.length > 0) {
        await this.signalRepository.save(signals);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Weekly EMA21 scan complete: ${signals.length} symbols (${exchange}) in ${duration}ms`,
      );

      this.notificationGateway.sendScanCompleteNotification({
        totalCount: signals.length,
        duration,
        timestamp: new Date(),
      });

      return { count: signals.length, duration };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Weekly EMA21 scan failed', errorMessage);
      this.notificationGateway.sendScanErrorNotification(errorMessage);
      return { count: 0, duration: Date.now() - startTime };
    }
  }

  async getLatestSignals(
    exchange: string = 'BINANCE',
    minPriceVsEma21: number = 0,
  ): Promise<{
    signals: WeeklyEma21SignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
  }> {
    const signals = await this.signalRepository
      .createQueryBuilder('s')
      .where('s.exchange = :exchange', { exchange })
      .andWhere('s.priceVsEma21 >= :min', { min: minPriceVsEma21 })
      .orderBy('s.priceVsEma21', 'DESC')
      .getMany();

    const lastUpdate = signals.length > 0 ? signals[0].createdAt : null;

    return {
      signals,
      lastUpdate,
      totalCount: signals.length,
    };
  }

  async getSignalsByStrength(
    strength: Ema21Strength,
    exchange: string = 'BINANCE',
  ): Promise<WeeklyEma21SignalEntity[]> {
    return this.signalRepository.find({
      where: { strength, exchange },
      order: { priceVsEma21: 'DESC' },
    });
  }
}
