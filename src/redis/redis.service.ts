import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private isConnected = false;

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries <= 1) {
              this.logger.warn('Redis connection failed; caching disabled');
              return false;
            }
            return Math.min(retries * 100, 30000);
          },
        },
      });

      this.client.on('error', () => {
        this.isConnected = false;
      });

      await this.client.connect();
      this.isConnected = true;
      this.logger.log('Redis connected');
    } catch {
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  // ==========================================
  // Health Check
  // ==========================================

  getHealthy(): boolean {
    return this.isConnected && this.client !== null;
  }

  // ==========================================
  // String Operations
  // ==========================================

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected || !this.client) return;

    try {
      if (ttlSeconds) {
        await this.client.set(key, value, { EX: ttlSeconds });
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.error(`Redis SET error for key ${key}`, err);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected || !this.client) return null;

    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(`Redis GET error for key ${key}`, err);
      return null;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.isConnected || !this.client) return 0;

    try {
      return await this.client.del(key);
    } catch (err) {
      this.logger.error(`Redis DEL error for key ${key}`, err);
      return 0;
    }
  }

  // ==========================================
  // JSON Operations
  // ==========================================

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const serialized = JSON.stringify(value);

    if (ttlSeconds) {
      await this.set(key, serialized, ttlSeconds);
    } else {
      await this.set(key, serialized);
    }
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.get(key);

    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  // ==========================================
  // List Operations (for accumulating events)
  // ==========================================

  async lpush(key: string, value: string): Promise<number> {
    if (!this.isConnected || !this.client) return 0;

    try {
      return await this.client.lPush(key, value);
    } catch (err) {
      this.logger.error(`Redis LPUSH error for key ${key}`, err);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.isConnected || !this.client) return [];

    try {
      return await this.client.lRange(key, start, stop);
    } catch (err) {
      this.logger.error(`Redis LRANGE error for key ${key}`, err);
      return [];
    }
  }

  async llen(key: string): Promise<number> {
    if (!this.isConnected || !this.client) return 0;

    try {
      return await this.client.lLen(key);
    } catch (err) {
      this.logger.error(`Redis LLEN error for key ${key}`, err);
      return 0;
    }
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    if (!this.isConnected || !this.client) return 0;

    try {
      return await this.client.lRem(key, count, value);
    } catch (err) {
      this.logger.error(`Redis LREM error for key ${key}`, err);
      return 0;
    }
  }
}
