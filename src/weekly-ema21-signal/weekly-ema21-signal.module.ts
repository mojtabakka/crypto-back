import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WeeklyEma21SignalService } from './weekly-ema21-signal.service';
import { WeeklyEma21SignalController } from './weekly-ema21-signal.controller';
import { WeeklyEma21SignalEntity } from './entities/weekly-ema21-signal.entity';
import { MarketScannerModule } from 'src/market-scanner/market-scanner.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeeklyEma21SignalEntity]),
    MarketScannerModule,
    NotificationModule,
  ],
  providers: [WeeklyEma21SignalService],
  controllers: [WeeklyEma21SignalController],
  exports: [WeeklyEma21SignalService],
})
export class WeeklyEma21SignalModule {}
