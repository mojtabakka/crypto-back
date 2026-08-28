import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';
import { WatchlistEntity } from './entities/watchlist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WatchlistEntity])],
  providers: [WatchlistService],
  controllers: [WatchlistController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
