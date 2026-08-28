import { Module } from '@nestjs/common';

import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { BinanceModule } from '../binance/binance.module';
import { LiquidationModule } from 'src/liquidation/liquidation.module';

@Module({
  imports: [LiquidationModule, BinanceModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
