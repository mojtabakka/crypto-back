import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LongShortSignalService } from './long-short-signal.service';
import { LongShortSignalController } from './long-short-signal.controller';
import { LongShortSignalEntity } from './entities/long-short-signal.entity';
import { MarketScannerModule } from 'src/market-scanner/market-scanner.module';
import { MarketSignalModule } from 'src/market-signal/market-signal.module';
import { FuturesSymbolsModule } from 'src/futures-symbols/futures-symbols.module';
import { ExchangeModule } from 'src/exchange/exchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LongShortSignalEntity]),
    MarketScannerModule,
    MarketSignalModule,
    FuturesSymbolsModule,
    ExchangeModule,
  ],
  providers: [LongShortSignalService],
  controllers: [LongShortSignalController],
  exports: [LongShortSignalService],
})
export class LongShortSignalModule {}
