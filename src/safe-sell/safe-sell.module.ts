import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { SafeSellService } from './safe-sell.service';
import { SafeSellController } from './safe-sell.controller';
import { SafeSellSignalEntity } from './entities/safe-sell-signal.entity';
import { ExchangeModule } from 'src/exchange/exchange.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SafeSellSignalEntity]),
    ScheduleModule.forRoot(),
    ExchangeModule,
    FuturesSymbolsModule,
    NotificationModule,
  ],
  controllers: [SafeSellController],
  providers: [SafeSellService],
  exports: [SafeSellService],
})
export class SafeSellModule {}
