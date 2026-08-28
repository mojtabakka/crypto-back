import { Module } from '@nestjs/common';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';

@Module({
  providers: [NewsService],
  exports: [NewsService],
  controllers: [NewsController],
})
export class NewsModule {}
