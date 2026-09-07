import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { PreMoveDetectorService } from './pre-move-detector.service';
import { PreMoveDetectorController } from './pre-move-detector.controller';
import { PreMoveSignalEntity } from './entities/pre-move-signal.entity';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationModule } from 'src/notification/notification.module';
import { LiquidationModule } from 'src/liquidation/liquidation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PreMoveSignalEntity]),
    ScheduleModule.forRoot(),
    RedisModule,
    NotificationModule,
    LiquidationModule,
  ],
  controllers: [PreMoveDetectorController],
  providers: [PreMoveDetectorService],
  exports: [PreMoveDetectorService],
})
export class PreMoveDetectorModule {}
