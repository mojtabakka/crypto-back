import { Module } from '@nestjs/common';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { IchimokuBaseConversionService } from './ichimoku-base-conversion.service';
import { IchimokuBaseConversionController } from './ichimoku-base-conversion.controller';

@Module({
  imports: [MultiExchangeKlineModule, FuturesSymbolsModule],
  providers: [IchimokuBaseConversionService],
  controllers: [IchimokuBaseConversionController],
  exports: [IchimokuBaseConversionService],
})
export class IchimokuBaseConversionModule {}
