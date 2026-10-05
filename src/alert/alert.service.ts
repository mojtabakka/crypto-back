import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PriceAlertEntity,
  AlertStatus,
  AlertCondition,
} from './entities/price-alert.entity';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';
import { BinanceService } from '../binance/binance.service';
import { NotificationGateway } from '../notification/notification.gateway';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  /**
   * Guards against overlapping cron runs. Without this, a slow tick can
   * overlap the next one and both write to the same rows, which produced
   * MySQL deadlocks against the other scheduled jobs.
   */
  private isChecking = false;

  constructor(
    @InjectRepository(PriceAlertEntity)
    private readonly alertRepository: Repository<PriceAlertEntity>,
    private readonly binanceService: BinanceService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async createAlert(username: string, dto: CreateAlertDto) {
    const alert = this.alertRepository.create({
      username,
      symbol: dto.symbol.toUpperCase(),
      targetPrice: dto.targetPrice,
      condition: dto.condition,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      note: dto.note ?? null,
      status: AlertStatus.ACTIVE,
    });

    const saved = await this.alertRepository.save(alert);

    this.logger.log(
      `Alert ${saved.id} created for ${username} - ${saved.symbol} ${saved.condition} ${saved.targetPrice}`,
    );

    return saved;
  }

  async getUserAlerts(username: string, status?: AlertStatus) {
    return this.alertRepository.find({
      where: status ? { username, status } : { username },
      order: { createdAt: 'DESC' },
    });
  }

  async getAlertById(username: string, alertId: number) {
    const alert = await this.alertRepository.findOne({
      where: { id: alertId, username },
    });

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    return alert;
  }

  async updateAlert(username: string, alertId: number, dto: UpdateAlertDto) {
    const alert = await this.getAlertById(username, alertId);

    if (alert.status === AlertStatus.TRIGGERED) {
      throw new BadRequestException('Cannot update a triggered alert');
    }

    if (dto.targetPrice !== undefined) alert.targetPrice = dto.targetPrice;
    if (dto.condition !== undefined) alert.condition = dto.condition;
    if (dto.status !== undefined) alert.status = dto.status;
    if (dto.expiresAt !== undefined) alert.expiresAt = new Date(dto.expiresAt);
    if (dto.note !== undefined) alert.note = dto.note;

    return this.alertRepository.save(alert);
  }

  async deleteAlert(username: string, alertId: number) {
    const alert = await this.getAlertById(username, alertId);
    await this.alertRepository.remove(alert);
    return { success: true };
  }

  async cancelAlert(username: string, alertId: number) {
    const alert = await this.getAlertById(username, alertId);

    if (alert.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException('Only active alerts can be cancelled');
    }

    alert.status = AlertStatus.CANCELLED;
    return this.alertRepository.save(alert);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkAlerts(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      await this.runCheck();
    } catch (error) {
      this.logger.error(
        `Alert check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isChecking = false;
    }
  }

  private async runCheck(): Promise<void> {
    const activeAlerts = await this.alertRepository.find({
      where: { status: AlertStatus.ACTIVE },
    });

    if (activeAlerts.length === 0) return;

    // Expire stale rows in one statement instead of one query per alert.
    const now = new Date();
    const expired = activeAlerts.filter(
      (alert) => alert.expiresAt && alert.expiresAt < now,
    );

    if (expired.length > 0) {
      await this.alertRepository.update(
        { id: In(expired.map((alert) => alert.id)) },
        { status: AlertStatus.EXPIRED },
      );
      this.logger.log(`Expired ${expired.length} alert(s)`);
    }

    const live = activeAlerts.filter(
      (alert) => !alert.expiresAt || alert.expiresAt >= now,
    );

    if (live.length === 0) return;

    const symbols = [...new Set(live.map((alert) => alert.symbol))];
    const triggered: PriceAlertEntity[] = [];

    for (const symbol of symbols) {
      try {
        const ticker = await this.binanceService.getTickerPrice(symbol);
        if (!ticker) continue;

        for (const alert of live.filter((a) => a.symbol === symbol)) {
          const hit =
            (alert.condition === AlertCondition.ABOVE &&
              ticker.price >= alert.targetPrice) ||
            (alert.condition === AlertCondition.BELOW &&
              ticker.price <= alert.targetPrice);

          if (!hit) continue;

          alert.status = AlertStatus.TRIGGERED;
          alert.triggeredPrice = ticker.price;
          alert.triggeredAt = new Date();
          triggered.push(alert);
        }
      } catch (error) {
        this.logger.error(
          `Failed to evaluate ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (triggered.length === 0) return;

    // Batch the write so the table is touched once per tick.
    await this.alertRepository.save(triggered);

    for (const alert of triggered) {
      const price = alert.triggeredPrice ?? 0;

      this.notificationGateway.sendPriceAlert({
        userId: 0,
        username: alert.username,
        alertId: alert.id,
        symbol: alert.symbol,
        targetPrice: alert.targetPrice,
        currentPrice: price,
        condition: alert.condition,
        note: alert.note,
      });

      this.logger.log(
        `Alert ${alert.id} triggered for ${alert.username} - ${alert.symbol} at ${price}`,
      );
    }
  }
}