import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketModule } from './market/market.module';
import { BinanceModule } from './binance/binance.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { MarketSignalModule } from './market-signal/market-signal.module';
import { MarketScannerModule } from './market-scanner/market-scanner.module';
import { RedisModule } from './redis/redis.module';
import { NewsModule } from './news/news.module';
import { FuturesSymbolsModule } from './futures-symbols/futures-symbols.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { FuturesSymbolEntity } from './futures-symbols/entities/futures-symbol.entity';
import { WatchlistEntity } from './watchlist/entities/watchlist.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'crypto_volume',
      entities: [FuturesSymbolEntity, WatchlistEntity],
      synchronize: true,
    }),
    RedisModule,
    MarketModule,
    BinanceModule,
    LiquidationModule,
    MarketSignalModule,
    MarketScannerModule,
    NewsModule,
    FuturesSymbolsModule,
    WatchlistModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
