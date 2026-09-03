import { Module } from '@nestjs/common';

import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { ExchangeModule } from '../exchange/exchange.module';
import { LiquidationModule } from 'src/liquidation/liquidation.module';

@Module({
  imports: [LiquidationModule, ExchangeModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
