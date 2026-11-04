import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { IchimokuCombinedSchedulerService } from '../ichimoku-combined-scheduler/ichimoku-combined-scheduler.service';

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: { id: number; username?: string };
    chat: { id: number | string; type?: string };
    text?: string;
    date?: number;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number | string } };
    data: string;
  };
}

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly scheduler: IchimokuCombinedSchedulerService,
  ) {}

  @Get('test')
  async test(@Query('chatId') chatId?: string): Promise<{ ok: boolean }> {
    const target = chatId || process.env.TELEGRAM_CHAT_ID || '';
    const success = await this.telegram.sendMessage(
      target,
      '<b>✅ Telegram Test</b>\nاتصال به بات تلگرام برقرار شد.',
    );
    return { ok: success };
  }

  @Post('webhook')
  async webhook(@Body() update: TelegramUpdate): Promise<{ ok: boolean }> {
    // Handle callback queries (inline keyboard button clicks)
    if (update.callback_query) {
      return this.handleCallbackQuery(update.callback_query);
    }

    // Handle text messages (commands)
    if (update.message?.text) {
      return this.handleMessage(update.message);
    }

    return { ok: true };
  }

  @Post('set-webhook')
  async setWebhook(@Query('url') url?: string): Promise<{ ok: boolean }> {
    const targetUrl = url || process.env.TELEGRAM_WEBHOOK_URL;
    if (!targetUrl) {
      return { ok: false };
    }
    const success = await this.telegram.setWebhook(targetUrl);
    return { ok: success };
  }

  @Get('webhook-info')
  async getWebhookInfo(): Promise<any> {
    return this.telegram.getWebhookInfo();
  }

  private async handleMessage(message: NonNullable<TelegramUpdate['message']>): Promise<{ ok: boolean }> {
    const chatId = String(message.chat.id);
    const text = message.text!.trim();

    // Parse /scan command: /scan 4h binance or /scan 1d
    const scanMatch = text.match(/^\/scan\s+(\w+)(?:\s+(\w+))?/i);
    if (scanMatch) {
      const interval = scanMatch[1].toLowerCase();
      const exchange = (scanMatch[2] || 'binance').toLowerCase();

      const validIntervals = ['4h', '1d', '1w'];
      const validExchanges = ['binance', 'bybit', 'mexc'];

      if (!validIntervals.includes(interval)) {
        await this.telegram.sendMessage(
          chatId,
          `<b>❌ Invalid interval</b>\nUse: 4h, 1d, or 1w\nExample: /scan 4h binance`,
        );
        return { ok: true };
      }

      if (!validExchanges.includes(exchange)) {
        await this.telegram.sendMessage(
          chatId,
          `<b>❌ Invalid exchange</b>\nUse: binance, bybit, or mexc\nExample: /scan 4h binance`,
        );
        return { ok: true };
      }

      await this.telegram.sendMessage(
        chatId,
        `<b>⏳ Starting Ichimoku scan...</b>\n<b>Interval:</b> ${interval}\n<b>Exchange:</b> ${exchange.toUpperCase()}\nPlease wait...`,
      );

      try {
        const result = await this.scheduler.sendToTelegram(interval, chatId, exchange);
        if (!result.sent) {
          await this.telegram.sendMessage(
            chatId,
            `<b>⚠️ Scan completed but failed to send results to Telegram.</b>`,
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await this.telegram.sendScanError(chatId, interval, msg);
      }

      return { ok: true };
    }

    // Handle /start command
    if (text === '/start' || text === '/help') {
      await this.telegram.sendMessageWithKeyboard(
        chatId,
        `<b>🤖 Ichimoku Scanner Bot</b>\n\n` +
          `Available commands:\n` +
          `• <code>/scan 4h binance</code> - Scan 4h timeframe\n` +
          `• <code>/scan 1d binance</code> - Scan daily timeframe\n` +
          `• <code>/scan 1w binance</code> - Scan weekly timeframe\n` +
          `• Exchanges: binance, bybit, mexc\n\n` +
          `Or use the buttons below:`,
        this.getStartKeyboard(),
      );
      return { ok: true };
    }

    // Unknown command
    await this.telegram.sendMessage(
      chatId,
      `<b>❓ Unknown command</b>\nSend /start to see available commands.`,
    );
    return { ok: true };
  }

  private async handleCallbackQuery(
    query: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<{ ok: boolean }> {
    const chatId = String(query.message.chat.id);
    const data = query.data;

    await this.telegram.answerCallbackQuery(query.id, 'Processing...');

    if (data.startsWith('scan_')) {
      const parts = data.split('_');
      const interval = parts[1]; // 4h, 1d, 1w
      const exchange = parts[2] || 'binance';

      await this.telegram.sendMessage(
        chatId,
        `<b>⏳ Starting Ichimoku scan...</b>\n<b>Interval:</b> ${interval}\n<b>Exchange:</b> ${exchange.toUpperCase()}\nPlease wait...`,
      );

      try {
        const result = await this.scheduler.sendToTelegram(interval, chatId, exchange);
        if (!result.sent) {
          await this.telegram.sendMessage(
            chatId,
            `<b>⚠️ Scan completed but failed to send results to Telegram.</b>`,
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await this.telegram.sendScanError(chatId, interval, msg);
      }
    } else if (data === 'change_exchange') {
      await this.telegram.sendMessage(
        chatId,
        `<b>🔄 Exchange Selection</b>\n\nUse:\n` +
          `• <code>/scan 4h binance</code>\n` +
          `• <code>/scan 1d bybit</code>\n` +
          `• <code>/scan 1w mexc</code>`,
      );
    }

    return { ok: true };
  }

  private getStartKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
    return [
      [
        { text: '🔍 Skān ۴ساعت (Binance)', callback_data: 'scan_4h_binance' },
        { text: '📅 Skān روزانه (Binance)', callback_data: 'scan_1d_binance' },
      ],
      [
        { text: '📆 Skān هفتگی (Binance)', callback_data: 'scan_1w_binance' },
        { text: '🔁 Skān ۴ساعت (Bybit)', callback_data: 'scan_4h_bybit' },
      ],
    ];
  }
}
