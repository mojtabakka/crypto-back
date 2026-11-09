import { Module } from '@nestjs/common';
import { IchimokuCombinedModule } from 'src/ichimoku-combined/ichimoku-combined.module';
import { BinanceModule } from 'src/binance/binance.module';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { IchimokuOiScreenerService } from './ichimoku-oi-screener.service';
import { IchimokuOiScreenerController } from './ichimoku-oi-screener.controller';

@Module({
  imports: [IchimokuCombinedModule, BinanceModule, MarketSignalModule, MultiExchangeKlineModule],
  providers: [IchimokuOiScreenerService],
  controllers: [IchimokuOiScreenerController],
  exports: [IchimokuOiScreenerService],
})
export class IchimokuOiScreenerModule {}
