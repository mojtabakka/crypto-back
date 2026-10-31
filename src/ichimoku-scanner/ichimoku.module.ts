import { Module } from '@nestjs/common';
import { BinanceModule } from 'src/binance/binance.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuScannerService } from './ichimoku.service';
import { IchimokuScannerController } from './ichimoku.controller';

@Module({
  imports: [BinanceModule, FuturesSymbolsModule],
  providers: [IchimokuScannerService],
  controllers: [IchimokuScannerController],
  exports: [IchimokuScannerService],
})
export class IchimokuScannerModule {}
