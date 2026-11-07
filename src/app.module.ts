import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketModule } from './market/market.module';
import { ExchangeModule } from './exchange/exchange.module';
import { MultiExchangeKlineModule } from './exchange/multi-exchange-kline.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { MarketSignalModule } from './market-signal/market-signal.module';
import { MarketScannerModule } from './market-scanner/market-scanner.module';
import { RedisModule } from './redis/redis.module';
import { NewsModule } from './news/news.module';
import { FuturesSymbolsModule } from './futures-symbols/futures-symbols.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationModule } from './notification/notification.module';
import { KlineModule } from './kline/kline.module';
import { VolumeProfileModule } from './volume-profile/volume-profile.module';
import { VolumeProfileScannerModule } from './volume-profile/volume-profile-scanner.module';
import { NewListingsModule } from './new-listings/new-listings.module';
import { TVLAnalysisModule } from './tvl-analysis/tvl-analysis.module';
import { TVLValidationModule } from './tvl-validation/tvl-validation.module';
import { ProtocolAnalysisModule } from './protocol-analysis/protocol-analysis.module';
import { CoinGlassModule } from './coinglass/coinglass.module';
import { PressureScanModule } from './pressure-scan/pressure-scan.module';
import { VolumeMarketCapModule } from './volume-marketcap/volume-marketcap.module';
import { IchimokuScannerModule } from './ichimoku-scanner/ichimoku.module';
import { IchimokuLaggingSpanModule } from './ichimoku-lagging-span/ichimoku-lagging-span.module';
import { IchimokuCombinedModule } from './ichimoku-combined/ichimoku-combined.module';
import { IchimokuCombinedSchedulerModule } from './ichimoku-combined-scheduler/ichimoku-combined-scheduler.module';
import { IchimokuBaseConversionModule } from './ichimoku-base-conversion/ichimoku-base-conversion.module';
import { IchimokuChikouPullbackModule } from './ichimoku-chikou-pullback/ichimoku-chikou-pullback.module';
import { IchimokuOiScreenerModule } from './ichimoku-oi-screener/ichimoku-oi-screener.module';
import { IchimokuCloudBottomTouchModule } from './ichimoku-cloud-bottom-touch/ichimoku-cloud-bottom-touch.module';
import { SymbolOiMonitorModule } from './symbol-oi-monitor/symbol-oi-monitor.module';
import { SymbolOiLiveMonitorModule } from './symbol-oi-live-monitor/symbol-oi-live-monitor.module';
import { NewListingEntity } from './new-listings/entities/new-listing.entity';
import { FuturesSymbolEntity } from './futures-symbols/entities/futures-symbol.entity';
import { WatchlistEntity } from './watchlist/entities/watchlist.entity';
import { KlineEntity } from './kline/entities/kline.entity';
import { VolumeProfileEntity } from './volume-profile/entities/volume-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'crypto_volume',
      entities: [
        FuturesSymbolEntity,
        WatchlistEntity,
        KlineEntity,
        VolumeProfileEntity,
        NewListingEntity,
      ],
      synchronize: true,
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    MarketModule,
    ExchangeModule,
    MultiExchangeKlineModule,
    LiquidationModule,
    MarketSignalModule,
    MarketScannerModule,
    NewsModule,
    FuturesSymbolsModule,
    WatchlistModule,
    NotificationModule,
    KlineModule,
    VolumeProfileModule,
    VolumeProfileScannerModule,
    NewListingsModule,
    TVLAnalysisModule,
    TVLValidationModule,
    ProtocolAnalysisModule,
    CoinGlassModule,
    PressureScanModule,
    VolumeMarketCapModule,
    IchimokuScannerModule,
    IchimokuLaggingSpanModule,
    IchimokuCombinedModule,
    IchimokuCombinedSchedulerModule,
    IchimokuBaseConversionModule,
    IchimokuChikouPullbackModule,
    IchimokuOiScreenerModule,
    SymbolOiMonitorModule,
    SymbolOiLiveMonitorModule,
    IchimokuCloudBottomTouchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
