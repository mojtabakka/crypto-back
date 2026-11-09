import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

@Controller('exchange/circuit-breakers')
export class CircuitBreakerController {
  constructor(private readonly breaker: CircuitBreakerService) {}

  /** Frontend polls this every minute to detect IP bans. */
  @Get()
  getStatus() {
    return this.breaker.snapshot();
  }

  /** "Try Reset Circuit Breaker" button in the global block overlay. */
  @Post('reset')
  @HttpCode(200)
  reset(@Query('exchange') exchange?: string, @Body() body?: { exchange?: string }) {
    const target = exchange ?? body?.exchange;
    return {
      success: true,
      breakers: this.breaker.reset(target),
    };
  }
}
