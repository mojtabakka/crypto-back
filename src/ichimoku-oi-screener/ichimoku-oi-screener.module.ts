import { Module } from '@nestjs/common';
import { IchimokuCombinedModule } from 'src/ichimoku-combined/ichimoku-combined.module';
import { BinanceModule } from 'src/binance/binance.module';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { IchimokuOiScreenerService } from './ichimoku-oi-screener.service';
import { IchimokuOiScreenerController } from './ichimoku-oi-screener.controller';

@Module({
  imports: [IchimokuCombinedModule, BinanceModule, MarketSignalModule, MultiExchangeKlineModule, FuturesSymbolsModule, VolumeMarketCapModule],
  providers: [IchimokuOiScreenerService],
  controllers: [IchimokuOiScreenerController],
  exports: [IchimokuOiScreenerService],
})
export class IchimokuOiScreenerModule {}
