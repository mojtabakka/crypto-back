import {
  Injectable,
  OnModuleInit,
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

interface PersistedLiquidation {
  time: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  price: number;
  value: number;
}

@Injectable()
export class LiquidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiquidationService.name);

  private socket?: WebSocket;

  private liquidations: LiquidationDto[] = [];

  private readonly REDIS_TTL = 7 * 24 * 60 * 60; // 7 days

  private readonly MAX_INMEMORY = 1000;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.socket?.close();
  }

  private connect() {
    this.socket = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');

    this.socket.on('open', () => {
      this.logger.log('Binance Liquidation WebSocket connected');
    });

    this.socket.on('message', (message: RawData) => {
      let text: string;

      if (Array.isArray(message)) {
        text = Buffer.concat(message.map((m) => Buffer.from(m))).toString();
      } else {
        text = Buffer.from(new Uint8Array(message)).toString();
      }

      void this.handleMessage(text);
    });

    this.socket.on('close', () => {
      this.logger.warn('Liquidation WebSocket disconnected');

      setTimeout(() => this.connect(), 5000);
    });

    this.socket.on('error', (error) => {
      this.logger.error('Liquidation WebSocket error:', error);
    });
  }

  private async handleMessage(message: string) {
    const data = JSON.parse(message) as BinanceLiquidationEvent;

    const order = data.o;

    if (!order) {
      return;
    }

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

    try {
      await this.persist(liquidation);
    } catch {
      // Redis is optional; live data keeps flowing without it.
    }

    this.cleanup();
  }

  // ==========================================
  // Redis Persistence
  // ==========================================

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

  // ==========================================
  // Cleanup
  // ==========================================

  private cleanup() {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;

    this.liquidations = this.liquidations.filter((item) => item.time >= cutoff);
  }

  // ==========================================
  // Recent in-memory liquidations (used by scanners)
  // ==========================================

  getRecentLiquidations(windowMs = 30 * 60 * 1000): LiquidationDto[] {
    const cutoff = Date.now() - windowMs;

    return this.liquidations.filter((item) => item.time >= cutoff);
  }

  // ==========================================
  // Get Liquidations (In-Memory + Redis)
  // ==========================================

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

    // ========================================
    // 1. In-Memory Data (live WebSocket)
    // ========================================

    const inMemory = this.liquidations.filter(
      (item) => item.symbol === symbol && item.time >= start,
    );

    // ========================================
    // 2. Redis Data (persisted historical)
    // ========================================

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

    // ========================================
    // 3. Merge (deduplicate by time)
    // ========================================

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
}
