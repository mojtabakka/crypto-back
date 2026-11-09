import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketModule } from './market/market.module';
import { ExchangeModule } from './exchange/exchange.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { MarketSignalModule } from './market-signal/market-signal.module';
import { MarketScannerModule } from './market-scanner/market-scanner.module';
import { RedisModule } from './redis/redis.module';
import { NewsModule } from './news/news.module';
import { FuturesSymbolsModule } from './futures-symbols/futures-symbols.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { FourHourSignalModule } from './four-hour-signal/four-hour-signal.module';
import { LongShortSignalModule } from './long-short-signal/long-short-signal.module';
import { NotificationModule } from './notification/notification.module';
import { KlineModule } from './kline/kline.module';
import { VolumeProfileModule } from './volume-profile/volume-profile.module';
import { VolumeProfileScannerModule } from './volume-profile/volume-profile-scanner.module';
import { NewListingsModule } from './new-listings/new-listings.module';
import { AuthModule } from './auth/auth.module';
import { CircuitBreakerModule } from './circuit-breaker/circuit-breaker.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SignalsSuiteModule } from './signals-suite/signals-suite.module';
import { IntelModule } from './intel/intel.module';
import { IchimokuModule } from './ichimoku/ichimoku.module';
import { LogsModule } from './logs/logs.module';
import { LoggingInterceptor } from './logs/logging.interceptor';
import { NewListingEntity } from './new-listings/entities/new-listing.entity';
import { FuturesSymbolEntity } from './futures-symbols/entities/futures-symbol.entity';
import { WatchlistEntity } from './watchlist/entities/watchlist.entity';
import { FourHourSignalEntity } from './four-hour-signal/entities/four-hour-signal.entity';
import { LongShortSignalEntity } from './long-short-signal/entities/long-short-signal.entity';
import { KlineEntity } from './kline/entities/kline.entity';
import { VolumeProfileEntity } from './volume-profile/entities/volume-profile.entity';
import { UserEntity } from './auth/users.entity';

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
        UserEntity,
        FuturesSymbolEntity,
        WatchlistEntity,
        FourHourSignalEntity,
        LongShortSignalEntity,
        KlineEntity,
        VolumeProfileEntity,
        NewListingEntity,
      ],
      synchronize: true,
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    CircuitBreakerModule,
    AnalyticsModule,
    LogsModule,
    AuthModule,
    MarketModule,
    ExchangeModule,
    LiquidationModule,
    MarketSignalModule,
    MarketScannerModule,
    NewsModule,
    FuturesSymbolsModule,
    WatchlistModule,
    FourHourSignalModule,
    LongShortSignalModule,
    NotificationModule,
    KlineModule,
    // Scanner module first: its /volume-profile/signals|scan routes must be
    // registered before the parameterised /volume-profile/:symbol route.
    VolumeProfileScannerModule,
    VolumeProfileModule,
    NewListingsModule,
    SignalsSuiteModule,
    IntelModule,
    IchimokuModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
