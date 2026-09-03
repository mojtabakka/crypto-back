import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FourHourSignalService } from './four-hour-signal.service';
import { FourHourSignalController } from './four-hour-signal.controller';
import { FourHourSignalEntity } from './entities/four-hour-signal.entity';
import { MarketScannerModule } from 'src/market-scanner/market-scanner.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FourHourSignalEntity]),
    MarketScannerModule,
    NotificationModule,
  ],
  providers: [FourHourSignalService],
  controllers: [FourHourSignalController],
  exports: [FourHourSignalService],
})
export class FourHourSignalModule {}
