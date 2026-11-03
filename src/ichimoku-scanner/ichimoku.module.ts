import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuScannerService } from './ichimoku.service';
import { IchimokuScannerController } from './ichimoku.controller';

@Module({
  imports: [MultiExchangeKlineModule, FuturesSymbolsModule],
  providers: [IchimokuScannerService],
  controllers: [IchimokuScannerController],
  exports: [IchimokuScannerService],
})
export class IchimokuScannerModule {}
