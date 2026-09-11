import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';

import { RawData, WebSocket } from 'ws';

import { LiquidationDto } from '../market/dto/liquidation.dto';
import { RedisService } from 'src/redis/redis.service';

interface BinanceLiquidationEvent {
  E: number;
  o: {
    s: string;
    S: string;
    q: string;
    p: string;
  };
}

interface BybitLiquidationMessage {
  topic: string;
  type: string;
  ts: number;
  data: {
    updatedTime: number;
    symbol: string;
    side: 'Buy' | 'Sell';
    size: string;
    price: string;
  };
}

interface PersistedLiquidation {
  time: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  price: number;
  value: number;
}

@Injectable()
export class LiquidationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LiquidationService.name);

  private binanceSocket?: WebSocket;
  private bybitSocket?: WebSocket;

  private liquidations: LiquidationDto[] = [];

  private readonly REDIS_TTL = 7 * 24 * 60 * 60;
  private readonly MAX_INMEMORY = 1000;

  private binanceConnected = false;
  private bybitConnected = false;
  private bybitResubscribeTimer?: NodeJS.Timeout;

  constructor(private readonly redisService: RedisService) {}

  onApplicationBootstrap() {
    this.logger.log(
      'Starting liquidation WebSockets (Binance + Bybit fallback)...',
    );
    this.connectBinance();
    this.connectBybit();
  }

  onModuleDestroy() {
    this.binanceSocket?.close();
    this.bybitSocket?.close();
    if (this.bybitResubscribeTimer) clearTimeout(this.bybitResubscribeTimer);
  }

  private connectBinance() {
    try {
      this.binanceSocket = new WebSocket(
        'wss://fstream.binance.com/ws/!forceOrder@arr',
      );

      this.binanceSocket.on('open', () => {
        this.binanceConnected = true;
        this.logger.log('✅ Binance Liquidation WebSocket connected (primary)');
      });

      this.binanceSocket.on('message', (message: RawData) => {
        let text: string;
        if (Array.isArray(message)) {
          text = Buffer.concat(message.map((m) => Buffer.from(m))).toString();
        } else {
          text = Buffer.from(new Uint8Array(message)).toString();
        }
        void this.handleBinanceMessage(text);
      });

      this.binanceSocket.on('close', () => {
        this.binanceConnected = false;
        this.logger.warn(
          '❌ Binance Liquidation WebSocket disconnected (will retry)',
        );
        setTimeout(() => this.connectBinance(), 10000);
      });

      this.binanceSocket.on('error', (error) => {
        this.binanceConnected = false;
        this.logger.warn(
          `Binance WebSocket error: ${error.message} — Bybit will continue providing data`,
        );
      });
    } catch (err) {
      this.logger.error(
        `Failed to connect to Binance: ${(err as Error).message}`,
      );
    }
  }

  private connectBybit() {
    try {
      this.bybitSocket = new WebSocket(
        'wss://stream.bybit.com/v5/public/linear',
      );

      this.bybitSocket.on('open', () => {
        this.bybitConnected = true;
        this.logger.log('✅ Bybit Liquidation WebSocket connected (fallback)');
        this.subscribeBybitLiquidations();
      });

      this.bybitSocket.on('message', (message: RawData) => {
        let text: string;
        if (Array.isArray(message)) {
          text = Buffer.concat(message.map((m) => Buffer.from(m))).toString();
        } else {
          text = Buffer.from(new Uint8Array(message)).toString();
        }
        void this.handleBybitMessage(text);
      });

      this.bybitSocket.on('close', () => {
        this.bybitConnected = false;
        this.logger.warn(
          '❌ Bybit Liquidation WebSocket disconnected (will retry)',
        );
        setTimeout(() => this.connectBybit(), 10000);
      });

      this.bybitSocket.on('error', (error) => {
        this.bybitConnected = false;
        this.logger.warn(`Bybit WebSocket error: ${error.message}`);
      });
    } catch (err) {
      this.logger.error(
        `Failed to connect to Bybit: ${(err as Error).message}`,
      );
    }
  }

  private subscribeBybitLiquidations() {
    if (!this.bybitSocket || !this.bybitConnected) return;

    const subscribeMsg = {
      op: 'subscribe',
      args: [
        'allLiquidation.BTCUSDT',
        'allLiquidation.ETHUSDT',
        'allLiquidation.SOLUSDT',
      ],
    };

    this.bybitSocket.send(JSON.stringify(subscribeMsg));
    this.logger.log('Subscribed to Bybit allLiquidation for top symbols');

    if (this.bybitResubscribeTimer) clearTimeout(this.bybitResubscribeTimer);
    this.bybitResubscribeTimer = setTimeout(() => {
      this.logger.log(
        'Bybit: re-subscribing after 30s to refresh subscription',
      );
      this.bybitSocket?.send(JSON.stringify(subscribeMsg));
    }, 30000);
  }

  private async handleBinanceMessage(message: string) {
    try {
      const data = JSON.parse(message) as BinanceLiquidationEvent;
      const order = data.o;
      if (!order) return;

      const quantity = Number(order.q);
      const price = Number(order.p);
      const liquidation: LiquidationDto = {
        time: data.E,
        symbol: order.s,
        side: order.S === 'SELL' ? 'LONG' : 'SHORT',
        quantity,
        price,
        value: quantity * price,
      };

      this.liquidations.push(liquidation);
      await this.persist(liquidation);
      this.cleanup();
    } catch (err) {
      this.logger.warn(
        `Failed to parse Binance liquidation: ${(err as Error).message}`,
      );
    }
  }

  private async handleBybitMessage(message: string) {
    try {
      const parsed = JSON.parse(message) as
        BybitLiquidationMessage | { op?: string; success?: boolean };

      if ('op' in parsed || 'success' in parsed) {
        return;
      }

      const liqMsg = parsed as BybitLiquidationMessage;
      if (
        !liqMsg.topic ||
        !liqMsg.topic.startsWith('allLiquidation.') ||
        !liqMsg.data
      ) {
        return;
      }

      const data = liqMsg.data;
      const symbol = data.symbol;
      const price = Number(data.price);
      const quantity = Number(data.size);
      const side: 'LONG' | 'SHORT' = data.side === 'Buy' ? 'SHORT' : 'LONG';

      const liquidation: LiquidationDto = {
        time: data.updatedTime,
        symbol,
        side,
        quantity,
        price,
        value: quantity * price,
      };

      this.liquidations.push(liquidation);
      await this.persist(liquidation);
    } catch (err) {
      this.logger.warn(
        `Failed to parse Bybit liquidation: ${(err as Error).message}`,
      );
    }
  }

  private async persist(liquidation: LiquidationDto): Promise<void> {
    const key = `liquidation:${liquidation.symbol}`;

    const entry = JSON.stringify({
      time: liquidation.time,
      symbol: liquidation.symbol,
      side: liquidation.side,
      quantity: liquidation.quantity,
      price: liquidation.price,
      value: liquidation.value,
    });

    await this.redisService.lpush(key, entry);

    const len = await this.redisService.llen(key);

    if (len > this.MAX_INMEMORY) {
      const serializedList = await this.redisService.lrange(
        key,
        this.MAX_INMEMORY,
        -1,
      );

      for (const raw of serializedList) {
        await this.redisService.lrem(key, 1, raw);
      }
    }
  }

  private cleanup() {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    this.liquidations = this.liquidations.filter((item) => item.time >= cutoff);
  }

  async getLiquidations(
    symbol: string,
    range: string,
  ): Promise<LiquidationDto[]> {
    const now = Date.now();
    const durations: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };

    const duration = durations[range];
    if (!duration) {
      throw new Error(`Unsupported range: ${range}`);
    }

    const start = now - duration;

    const inMemory = this.liquidations.filter(
      (item) => item.symbol === symbol && item.time >= start,
    );

    const redisKey = `liquidation:${symbol}`;
    const redisRaw = await this.redisService.lrange(redisKey, 0, -1);

    const redisData: LiquidationDto[] = [];

    for (const raw of redisRaw) {
      try {
        const parsed = JSON.parse(raw) as PersistedLiquidation;
        if (parsed.symbol === symbol && parsed.time >= start) {
          redisData.push({
            time: parsed.time,
            symbol: parsed.symbol,
            side: parsed.side,
            quantity: parsed.quantity,
            price: parsed.price,
            value: parsed.value,
          });
        }
      } catch {
        continue;
      }
    }

    const seen = new Set(inMemory.map((item) => item.time));
    const merged = [...inMemory];

    for (const item of redisData) {
      if (!seen.has(item.time)) {
        merged.push(item);
        seen.add(item.time);
      }
    }

    return merged.sort((a, b) => a.time - b.time);
  }

  getStatus(): { binance: boolean; bybit: boolean } {
    return {
      binance: this.binanceConnected,
      bybit: this.bybitConnected,
    };
  }
}
