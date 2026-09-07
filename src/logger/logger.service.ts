import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface LogEntry {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  ms?: string;
}

@Injectable()
export class LoggerService {
  private readonly logger = new Logger(LoggerService.name);
  private readonly logDir = process.env.LOG_DIR ?? './logs';
  private cache: LogEntry[] = [];
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 5000;

  async getRecentLogs(options: {
    level?: string;
    limit?: number;
    search?: string;
  }): Promise<{ entries: LogEntry[]; total: number }> {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_TTL || this.cache.length === 0) {
      await this.refreshCache();
    }

    let filtered = this.cache;

    if (options.level) {
      filtered = filtered.filter((e) => e.level === options.level);
    }

    if (options.search) {
      const search = options.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(search) ||
          e.context?.toLowerCase().includes(search),
      );
    }

    const limit = options.limit ?? 100;
    return {
      entries: filtered.slice(0, limit),
      total: filtered.length,
    };
  }

  private async refreshCache(): Promise<void> {
    try {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);
      const logFile = path.join(this.logDir, 'combined', `combined-${dateStr}.log`);

      try {
        const content = await fs.readFile(logFile, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        this.cache = lines
          .map((line) => this.parseLogLine(line))
          .filter((entry): entry is LogEntry => entry !== null)
          .reverse();
        this.lastCacheUpdate = Date.now();
      } catch {
        this.cache = [];
      }
    } catch (error) {
      this.logger.error('Failed to refresh log cache', error);
    }
  }

  private parseLogLine(line: string): LogEntry | null {
    try {
      const parsed = JSON.parse(line);
      return {
        timestamp: parsed.timestamp ?? '',
        level: parsed.level ?? 'info',
        context: parsed.context,
        message: parsed.message ?? '',
        ms: parsed.ms,
      };
    } catch {
      return null;
    }
  }

  addEntry(entry: LogEntry): void {
    this.cache.unshift(entry);
    if (this.cache.length > 10000) {
      this.cache = this.cache.slice(0, 10000);
    }
  }
}
