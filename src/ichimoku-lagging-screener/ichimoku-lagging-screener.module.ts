import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IchimokuCombinedModule } from 'src/ichimoku-combined/ichimoku-combined.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { MultiExchangeKlineModule } from 'src/exchange/multi-exchange-kline.module';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { VolumeMarketCapModule } from 'src/volume-marketcap/volume-marketcap.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IchimokuLaggingScreenerService } from './ichimoku-lagging-screener.service';
import { IchimokuLaggingScreenerController } from './ichimoku-lagging-screener.controller';
import { IchimokuLaggingSignalEntity } from './entities/ichimoku-lagging-signal.entity';

@Module({
  imports: [
    IchimokuCombinedModule,
    FuturesSymbolsModule,
    MultiExchangeKlineModule,
    MarketSignalModule,
    VolumeMarketCapModule,
    TypeOrmModule.forFeature([IchimokuLaggingSignalEntity]),
  ],
  providers: [IchimokuLaggingScreenerService],
  controllers: [IchimokuLaggingScreenerController],
  exports: [IchimokuLaggingScreenerService],
})
export class IchimokuLaggingScreenerModule {}
