import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SentimentService } from './sentiment.service';
import { SentimentController } from './sentiment.controller';
import { SentimentAnalysisEntity } from './entities/sentiment-analysis.entity';
import { NewsModule } from '../news/news.module';
import { BinanceModule } from '../binance/binance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SentimentAnalysisEntity]),
    NewsModule,
    BinanceModule,
  ],
  providers: [SentimentService],
  controllers: [SentimentController],
  exports: [SentimentService],
})
export class SentimentModule {}
