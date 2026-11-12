import { Module } from '@nestjs/common';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { IchimokuCalculatorService } from './ichimoku-calculator.service';
import { SignalEnricherService } from './signal-enricher.service';

@Module({
  imports: [MarketSignalModule],
  providers: [IchimokuCalculatorService, SignalEnricherService],
  exports: [IchimokuCalculatorService, SignalEnricherService],
})
export class IchimokuModule {}