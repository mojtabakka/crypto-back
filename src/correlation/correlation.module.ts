import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CorrelationService } from './correlation.service';
import { CorrelationController } from './correlation.controller';
import { CorrelationSnapshotEntity } from './entities/correlation-snapshot.entity';
import { CorrelationPairEntity } from './entities/correlation-pair.entity';
import { KlineModule } from '../kline/kline.module';
import { FuturesSymbolsModule } from '../futures-symbols/futures-symbols.module';
import { NotificationModule } from '../notification/notification.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CorrelationSnapshotEntity, CorrelationPairEntity]),
    KlineModule,
    FuturesSymbolsModule,
    NotificationModule,
    RedisModule,
  ],
  providers: [CorrelationService],
  controllers: [CorrelationController],
  exports: [CorrelationService],
})
export class CorrelationModule {}