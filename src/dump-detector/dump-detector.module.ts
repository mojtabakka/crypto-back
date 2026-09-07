import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { DumpDetectorService } from './dump-detector.service';
import { DumpDetectorController } from './dump-detector.controller';
import { DumpAlertEntity } from './entities/dump-alert.entity';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DumpAlertEntity]),
    ScheduleModule.forRoot(),
    ExchangeModule,
    FuturesSymbolsModule,
    NotificationModule,
  ],
  controllers: [DumpDetectorController],
  providers: [DumpDetectorService],
  exports: [DumpDetectorService],
})
export class DumpDetectorModule {}
