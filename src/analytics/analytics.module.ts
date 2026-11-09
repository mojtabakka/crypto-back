import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { CircuitBreakerModule } from 'src/circuit-breaker/circuit-breaker.module';

@Module({
  imports: [CircuitBreakerModule],
  providers: [MarketDataService],
  exports: [MarketDataService, CircuitBreakerModule],
})
export class AnalyticsModule {}
