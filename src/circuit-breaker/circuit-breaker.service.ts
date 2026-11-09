import { Injectable, Logger } from '@nestjs/common';

export interface BreakerStatus {
  blocked: boolean;
  blockedUntil?: number;
  blockCount?: number;
  msRemaining?: number;
}

interface BreakerState {
  blockedUntil: number;
  blockCount: number;
  lastBlockAt: number;
}

/**
 * Tracks upstream IP bans / rate limits (Binance 418/429).
 *
 * The frontend polls GET /exchange/circuit-breakers and disables the whole UI
 * while an exchange is blocked, so this is the single source of truth for
 * "are we allowed to call the exchange right now".
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  /** Per-exchange breaker state. */
  private readonly states = new Map<string, BreakerState>();

  /** Default cool-down when the exchange does not send Retry-After. */
  private readonly DEFAULT_BLOCK_MS = 5 * 60 * 1000;

  registerBlock(exchange: string, retryAfterSeconds?: number): void {
    const key = exchange.toUpperCase();
    const now = Date.now();
    const previous = this.states.get(key);
    const blockMs = retryAfterSeconds
      ? Math.min(retryAfterSeconds * 1000, 60 * 60 * 1000)
      : this.DEFAULT_BLOCK_MS;

    const state: BreakerState = {
      blockedUntil: now + blockMs,
      blockCount: (previous?.blockCount ?? 0) + 1,
      lastBlockAt: now,
    };

    this.states.set(key, state);

    this.logger.warn(
      `Circuit breaker opened for ${key} (block #${state.blockCount}, ` +
        `${Math.ceil(blockMs / 1000)}s)`,
    );
  }

  isBlocked(exchange = 'BINANCE'): boolean {
    const state = this.states.get(exchange.toUpperCase());
    if (!state) return false;

    if (state.blockedUntil <= Date.now()) {
      this.states.delete(exchange.toUpperCase());
      return false;
    }

    return true;
  }

  /** Milliseconds until the exchange is usable again (0 when not blocked). */
  blockedForMs(exchange = 'BINANCE'): number {
    const state = this.states.get(exchange.toUpperCase());
    if (!state) return 0;
    return Math.max(0, state.blockedUntil - Date.now());
  }

  snapshot(): Record<string, BreakerStatus> {
    const now = Date.now();
    const result: Record<string, BreakerStatus> = {};

    for (const [exchange, state] of this.states.entries()) {
      const msRemaining = state.blockedUntil - now;

      if (msRemaining <= 0) {
        this.states.delete(exchange);
        result[exchange] = {
          blocked: false,
          blockCount: state.blockCount,
          blockedUntil: state.blockedUntil,
          msRemaining: 0,
        };
        continue;
      }

      result[exchange] = {
        blocked: true,
        blockedUntil: state.blockedUntil,
        blockCount: state.blockCount,
        msRemaining,
      };
    }

    return result;
  }

  /** Clear one exchange, or every breaker when no argument is given. */
  reset(exchange?: string): Record<string, BreakerStatus> {
    if (exchange) {
      this.states.delete(exchange.toUpperCase());
    } else {
      this.states.clear();
    }

    this.logger.log(
      exchange ? `Circuit breaker reset for ${exchange}` : 'All circuit breakers reset',
    );

    return this.snapshot();
  }
}
