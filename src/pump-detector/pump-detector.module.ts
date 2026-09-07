import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { PumpDetectorService } from './pump-detector.service';
import { PumpDetectorController } from './pump-detector.controller';
import { PumpAlertEntity } from './entities/pump-alert.entity';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PumpAlertEntity]),
    ScheduleModule.forRoot(),
    ExchangeModule,
    FuturesSymbolsModule,
    NotificationModule,
  ],
  controllers: [PumpDetectorController],
  providers: [PumpDetectorService],
  exports: [PumpDetectorService],
})
export class PumpDetectorModule {}
