import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketScannerService } from 'src/market-scanner/market-scanner.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import {
  FourHourSignalEntity,
  SignalType,
  SignalDirection,
} from './entities/four-hour-signal.entity';

@Injectable()
export class FourHourSignalService {
  private readonly logger = new Logger(FourHourSignalService.name);

  constructor(
    private readonly marketScannerService: MarketScannerService,
    private readonly notificationGateway: NotificationGateway,
    @InjectRepository(FourHourSignalEntity)
    private readonly signalRepository: Repository<FourHourSignalEntity>,
  ) {}

  @Cron('5 1,5,9,13,17,21 * * *')
  async handleCron() {
    await this.scanAndStoreSignals();
  }

  private async scanAndStoreSignals() {
    const startTime = Date.now();
    this.logger.log('Starting 4h signal scan...');

    try {
      await this.signalRepository.clear();

      const [pullbacks, reapproaches] = await Promise.all([
        this.marketScannerService.scanForPullbacks4h(100),
        this.marketScannerService.scanForReapproach4h(100),
      ]);

      const signals: FourHourSignalEntity[] = [];

      for (const item of pullbacks.all) {
        const entity = new FourHourSignalEntity();
        entity.symbol = item.symbol;
        entity.signalType = 'PULLBACK';
        entity.direction =
          item.maPullback === 'BULLISH_PULLBACK' ? 'BULLISH' : 'BEARISH';
        entity.score = item.score;
        entity.priceChange = item.priceChange ?? null;
        entity.oiChange = item.oiChange ?? null;
        entity.touchCount = item.maPullbackTouches;
        entity.priceVsEma50 = item.priceVsEma50 ?? null;
        entity.currentPrice = item.currentPrice;
        entity.ema50 = item.ema50 ?? null;
        entity.currentDistance = null;
        entity.breakoutDay = null;
        signals.push(entity);
      }

      for (const item of reapproaches.all) {
        const entity = new FourHourSignalEntity();
        entity.symbol = item.symbol;
        entity.signalType = 'REAPPROACH';
        entity.direction =
          item.maReapproach === 'BULLISH_REAPPROACH' ? 'BULLISH' : 'BEARISH';
        entity.score = item.score;
        entity.priceChange = item.priceChange ?? null;
        entity.oiChange = item.oiChange ?? null;
        entity.touchCount = 0;
        entity.priceVsEma50 = item.priceVsEma50 ?? null;
        entity.currentPrice = item.currentPrice;
        entity.ema50 = item.ema50 ?? null;
        entity.currentDistance = item.currentDistance ?? null;
        entity.breakoutDay = item.breakoutDay ? String(item.breakoutDay) : null;
        signals.push(entity);
      }

      await this.signalRepository.save(signals);

      const duration = Date.now() - startTime;
      this.logger.log(
        `4h signal scan complete: ${signals.length} signals saved in ${duration}ms`,
      );

      this.notificationGateway.sendScanCompleteNotification({
        totalCount: signals.length,
        duration,
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('4h signal scan failed', errorMessage);
      this.notificationGateway.sendScanErrorNotification(errorMessage);
    }
  }

  async getLatestSignals(): Promise<{
    signals: FourHourSignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
  }> {
    const signals = await this.signalRepository.find({
      order: { score: 'DESC' },
    });

    const lastUpdate = signals.length > 0 ? signals[0].createdAt : null;

    return {
      signals,
      lastUpdate,
      totalCount: signals.length,
    };
  }

  async getSignalsByType(type: SignalType): Promise<FourHourSignalEntity[]> {
    return this.signalRepository.find({
      where: { signalType: type },
      order: { score: 'DESC' },
    });
  }

  async getSignalsByDirection(
    direction: SignalDirection,
  ): Promise<FourHourSignalEntity[]> {
    return this.signalRepository.find({
      where: { direction },
      order: { score: 'DESC' },
    });
  }
}
