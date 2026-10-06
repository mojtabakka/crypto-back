import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { BacktestResultEntity } from './entities/backtest-result.entity';
import { KlineModule } from '../kline/kline.module';
import { BinanceModule } from '../binance/binance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BacktestResultEntity]),
    KlineModule,
    BinanceModule,
  ],
  providers: [BacktestService],
  controllers: [BacktestController],
  exports: [BacktestService],
})
export class BacktestModule {}