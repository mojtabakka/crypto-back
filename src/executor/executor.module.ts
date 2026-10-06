import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutorService } from './executor.service';
import { ExecutorController } from './executor.controller';
import { PositionEntity } from './entities/position.entity';
import { ExecutorSettingsEntity } from './entities/executor-settings.entity';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
import { KlineModule } from '../kline/kline.module';
import { BinanceModule } from '../binance/binance.module';
import { NotificationModule } from '../notification/notification.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PositionEntity, ExecutorSettingsEntity]),
    MarketScannerModule,
    KlineModule,
    BinanceModule,
    NotificationModule,
    RedisModule,
  ],
  providers: [ExecutorService],
  controllers: [ExecutorController],
  exports: [ExecutorService],
})
export class ExecutorModule {}