import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { IchimokuCombinedService } from '../ichimoku-combined/ichimoku-combined.service';
import { TelegramService } from '../notification/telegram.service';

const DEFAULT_EXCHANGE = 'binance';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

@Injectable()
export class IchimokuCombinedSchedulerService {
  private readonly logger = new Logger(IchimokuCombinedSchedulerService.name);

  constructor(
    private readonly ichimokuService: IchimokuCombinedService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('0 */4 * * *', { timeZone: 'Asia/Tehran' })
  async scanEvery4Hours() {
    this.logger.log('Ichimoku combined 4h scan started');
    await this.runScan('4h');
  }

  @Cron('30 3 * * *', { timeZone: 'Asia/Tehran' })
  async scanDaily() {
    this.logger.log('Ichimoku combined daily scan started');
    await this.runScan('1d');
  }

  @Cron('30 3 * * 1', { timeZone: 'Asia/Tehran' })
  async scanWeekly() {
    this.logger.log('Ichimoku combined weekly scan started');
    await this.runScan('1w');
  }

  async sendToTelegram(
    interval: string,
    chatId: string,
    exchange: string = DEFAULT_EXCHANGE,
  ): Promise<{ sent: boolean; matches: number; totalScanned: number }> {
    const result = await this.ichimokuService.scan({
      interval,
      exchange,
    });

    const sent = await this.telegram.sendIchimokuSignals(
      chatId,
      interval,
      exchange,
      result,
    );

    return {
      sent,
      matches: result.matches.length,
      totalScanned: result.totalScanned,
    };
  }

  private async runScan(interval: string) {
    try {
      const result = await this.ichimokuService.scan({
        interval,
        exchange: DEFAULT_EXCHANGE,
      });

      if (CHAT_ID) {
        await this.telegram.sendIchimokuSignals(
          CHAT_ID,
          interval,
          DEFAULT_EXCHANGE,
          result,
        );
      }

      this.logger.log(
        `Ichimoku ${interval} scan complete: ${result.matches.length} signals from ${result.totalScanned} symbols`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ichimoku ${interval} scan failed`, msg);
      if (CHAT_ID) {
        await this.telegram.sendScanError(CHAT_ID, interval, msg);
      }
    }
  }
}
