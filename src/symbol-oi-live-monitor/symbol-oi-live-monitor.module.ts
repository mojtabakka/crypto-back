import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { SymbolOiLiveMonitorService } from './symbol-oi-live-monitor.service';
import { SymbolOiLiveMonitorGateway } from './symbol-oi-live-monitor.gateway';

@Module({
  imports: [BinanceModule],
  providers: [SymbolOiLiveMonitorService, SymbolOiLiveMonitorGateway],
  exports: [SymbolOiLiveMonitorService],
})
export class SymbolOiLiveMonitorModule {}
