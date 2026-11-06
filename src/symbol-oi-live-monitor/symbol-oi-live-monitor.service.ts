import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { BinanceService } from 'src/binance/binance.service';

const POLL_INTERVAL_MS = 10000; // 10 seconds for OI polling

type StatusChangeCallback = (status: any) => void;

interface SymbolData {
  symbol: string;
  price: number;
  priceChangePct: number;
  oiChangePct: number;
  classification:
    | 'LONG_BUILDUP'
    | 'SHORT_COVERING'
    | 'LONG_LIQUIDATION'
    | 'SHORT_BUILDUP'
    | 'NEUTRAL';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  lastUpdated: string;
  ws?: WebSocket;
  oiInterval?: NodeJS.Timeout;
}

@Injectable()
export class SymbolOiLiveMonitorService {
  private readonly logger = new Logger(SymbolOiLiveMonitorService.name);

  private readonly symbols = new Map<string, SymbolData>();
  private readonly statusChangeCallbacks = new Set<StatusChangeCallback>();

  constructor(private readonly binanceService: BinanceService) {}

  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.add(callback);
  }

  offStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.delete(callback);
  }

  private emitStatusChange(status: SymbolData): void {
    this.statusChangeCallbacks.forEach((cb) => {
      try {
        cb(status);
      } catch (error) {
        this.logger.warn(`Status change callback error: ${error}`);
      }
    });
  }

  subscribe(symbol: string): void {
    const sym = symbol.toUpperCase();
    if (this.symbols.has(sym)) {
      return; // Already subscribed
    }

    this.logger.log(`Subscribing to live OI monitor: ${sym}`);

    const data: SymbolData = {
      symbol: sym,
      price: 0,
      priceChangePct: 0,
      oiChangePct: 0,
      classification: 'NEUTRAL',
      direction: 'NEUTRAL',
      lastUpdated: new Date().toISOString(),
    };

    this.symbols.set(sym, data);

    // Connect to Binance WebSocket for real-time price
    this.connectWebSocket(sym);

    // Start OI polling
    this.startOIPolling(sym);
  }

  unsubscribe(symbol: string): void {
    const sym = symbol.toUpperCase();
    const data = this.symbols.get(sym);
    if (!data) return;

    this.logger.log(`Unsubscribing from live OI monitor: ${sym}`);

    // Close WebSocket
    data.ws?.close();

    // Clear OI polling interval
    if (data.oiInterval) {
      clearInterval(data.oiInterval);
    }

    this.symbols.delete(sym);
  }

  isSubscribed(symbol: string): boolean {
    return this.symbols.has(symbol.toUpperCase());
  }

  getStatus(symbol: string): SymbolData | null {
    return this.symbols.get(symbol.toUpperCase()) ?? null;
  }

  getAllStatuses(): SymbolData[] {
    return Array.from(this.symbols.values());
  }

  private connectWebSocket(symbol: string): void {
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@ticker`;
    const ws = new WebSocket(wsUrl);

    const data = this.symbols.get(symbol);
    if (!data) return;
    data.ws = ws;

    ws.on('open', () => {
      this.logger.log(`Binance WebSocket connected: ${symbol}`);
    });

    ws.on('message', (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString()) as {
          c?: string;
          P?: string;
        };
        const sd = this.symbols.get(symbol);
        if (!sd) return;

        // Binance ticker event
        sd.price = Number(parsed.c ?? 0);
        sd.priceChangePct = Number(parsed.P ?? 0);

        this.updateClassification(sd);
        sd.lastUpdated = new Date().toISOString();

        // Emit change event
        this.emitStatusChange(sd);
      } catch (error) {
        this.logger.warn(
          `WebSocket message parse error for ${symbol}: ${error}`,
        );
      }
    });

    ws.on('error', (error: Error) => {
      this.logger.error(`WebSocket error for ${symbol}: ${error.message}`);
    });

    ws.on('close', () => {
      this.logger.warn(`WebSocket closed: ${symbol}`);
      const sd = this.symbols.get(symbol);
      if (sd) {
        sd.ws = undefined;
        // Reconnect after 5 seconds
        setTimeout(() => {
          if (!this.symbols.has(symbol)) return;
          if (!this.symbols.get(symbol)?.ws) {
            this.connectWebSocket(symbol);
          }
        }, 5000);
      }
    });
  }

  private startOIPolling(symbol: string): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const interval = setInterval(async () => {
      const sd = this.symbols.get(symbol);
      if (!sd) {
        clearInterval(interval);
        return;
      }

      try {
        const now = Date.now();
        const startTime = now - 60 * 60 * 1000; // 1 hour lookback

        const oiHistory = await this.binanceService.rateLimit(() =>
          this.binanceService.getOpenInterest(symbol, startTime, now),
        );

        if (oiHistory && oiHistory.length >= 2) {
          const firstOI = Number(oiHistory[0].sumOpenInterest);
          const lastOI = Number(
            oiHistory[oiHistory.length - 1].sumOpenInterest,
          );

          if (firstOI > 0) {
            sd.oiChangePct = ((lastOI - firstOI) / firstOI) * 100;
            this.updateClassification(sd);
            sd.lastUpdated = new Date().toISOString();

            // Emit change event
            this.emitStatusChange(sd);
          }
        }
      } catch (error) {
        this.logger.warn(`OI polling error for ${symbol}: ${error}`);
      }
    }, POLL_INTERVAL_MS);

    const sd = this.symbols.get(symbol);
    if (sd) {
      sd.oiInterval = interval;
    }
  }

  private updateClassification(sd: SymbolData): void {
    const priceUp = sd.priceChangePct > 0;
    const priceDown = sd.priceChangePct < 0;
    const oiUp = sd.oiChangePct > 0;
    const oiDown = sd.oiChangePct < 0;

    if (priceUp && oiUp) {
      sd.classification = 'LONG_BUILDUP';
      sd.direction = 'LONG';
    } else if (priceUp && oiDown) {
      sd.classification = 'SHORT_COVERING';
      sd.direction = 'LONG';
    } else if (priceDown && oiDown) {
      sd.classification = 'LONG_LIQUIDATION';
      sd.direction = 'SHORT';
    } else if (priceDown && oiUp) {
      sd.classification = 'SHORT_BUILDUP';
      sd.direction = 'SHORT';
    } else {
      sd.classification = 'NEUTRAL';
      sd.direction = 'NEUTRAL';
    }
  }
}
