import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN || '9046153053:AAF5DKIHEr4j6sNX3M2lY1IciyZKbtZeSc8';
  private readonly botUsername = process.env.TELEGRAM_BOT_USERNAME || 'mr_binovabot';
  private readonly apiUrl = `https://api.telegram.org/bot${this.botToken}`;

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram send failed: ${msg}`);
      return false;
    }
  }

  async sendMessageWithKeyboard(
    chatId: string,
    text: string,
    keyboard: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<boolean> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram send with keyboard failed: ${msg}`);
      return false;
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    try {
      await axios.post(`${this.apiUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text,
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram answer callback failed: ${msg}`);
      return false;
    }
  }

  async setWebhook(url: string): Promise<boolean> {
    try {
      await axios.post(`${this.apiUrl}/setWebhook`, { url });
      this.logger.log(`Telegram webhook set: ${url}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram setWebhook failed: ${msg}`);
      return false;
    }
  }

  async deleteWebhook(): Promise<boolean> {
    try {
      await axios.post(`${this.apiUrl}/deleteWebhook`);
      this.logger.log('Telegram webhook deleted');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram deleteWebhook failed: ${msg}`);
      return false;
    }
  }

  async getWebhookInfo(): Promise<any> {
    try {
      const response = await axios.get(`${this.apiUrl}/getWebhookInfo`);
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Telegram getWebhookInfo failed: ${msg}`);
      return null;
    }
  }

  async sendIchimokuSignals(
    chatId: string,
    interval: string,
    exchange: string,
    result: { totalScanned: number; matches: Array<{ symbol: string; price: number; barsAgo: number; score: number }> },
  ): Promise<boolean> {
    const { matches, totalScanned } = result;

    if (matches.length === 0) {
      return this.sendMessageWithKeyboard(
        chatId,
        `<b>📊 Ichimoku Combined Scan</b>\n` +
          `<b>Interval:</b> ${interval}\n` +
          `<b>Exchange:</b> ${exchange.toUpperCase()}\n` +
          `<b>Scanned:</b> ${totalScanned} symbols\n` +
          `<b>Signals:</b> No bullish Ichimoku signals found.\n` +
          `<i>${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</i>`,
        this.getQuickScanKeyboard(),
      );
    }

    const header =
      `<b>📊 Ichimoku Combined Scan</b>\n` +
      `<b>Interval:</b> ${interval}\n` +
      `<b>Exchange:</b> ${exchange.toUpperCase()}\n` +
      `<b>Scanned:</b> ${totalScanned} symbols\n` +
      `<b>Signals found:</b> ${matches.length}\n\n`;

    const lines = matches.map(
      (s) =>
        `• <b>${s.symbol}</b> — <i>$${s.price.toLocaleString()}</i> ` +
        `(cross ${s.barsAgo} bars ago, score ${s.score})`,
    );

    const footer = `\n\n<i>${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</i>`;

    const MAX_MESSAGE_LENGTH = 3800;
    let current = header;
    const messages: string[] = [];

    for (const line of lines) {
      if (current.length + line.length + 1 + footer.length > MAX_MESSAGE_LENGTH) {
        messages.push(current + footer);
        current = header;
      }
      current += line + '\n';
    }
    messages.push(current + footer);

    let success = true;
    for (let i = 0; i < messages.length; i++) {
      const isLast = i === messages.length - 1;
      const sent = isLast
        ? await this.sendMessageWithKeyboard(chatId, messages[i], this.getQuickScanKeyboard())
        : await this.sendMessage(chatId, messages[i]);
      if (!sent) success = false;
    }
    return success;
  }

  async sendScanError(
    chatId: string,
    interval: string,
    error: string,
  ): Promise<boolean> {
    return this.sendMessage(
      chatId,
      `<b>❌ Ichimoku Scan Error</b>\n` +
        `<b>Interval:</b> ${interval}\n` +
        `<b>Error:</b> ${error}\n` +
        `<i>${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</i>`,
    );
  }

  private getQuickScanKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
    return [
      [
        { text: '🔍 Skān ۴ساعت', callback_data: 'scan_4h_binance' },
        { text: '📅 Skān روزانه', callback_data: 'scan_1d_binance' },
      ],
      [
        { text: '📆 Skān هفتگی', callback_data: 'scan_1w_binance' },
        { text: '🔁 تغییر صرافی', callback_data: 'change_exchange' },
      ],
    ];
  }
}
