import { Module } from '@nestjs/common';
import { PressureScanService } from './pressure-scan.service';
import { PressureScanController } from './pressure-scan.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { FuturesSymbolsModule } from '../futures-symbols/futures-symbols.module';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';

@Module({
  imports: [ExchangeModule, FuturesSymbolsModule, MarketScannerModule],
  providers: [PressureScanService],
  controllers: [PressureScanController],
  exports: [PressureScanService],
})
export class PressureScanModule {}
