import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { SymbolOiMonitorService } from './symbol-oi-monitor.service';
import { SymbolOiMonitorController } from './symbol-oi-monitor.controller';

@Module({
  imports: [BinanceModule],
  providers: [SymbolOiMonitorService],
  controllers: [SymbolOiMonitorController],
  exports: [SymbolOiMonitorService],
})
export class SymbolOiMonitorModule {}
