import { Controller, Get, Post, Delete, Body, Query } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist() {
    return this.watchlistService.getWatchlist();
  }

  @Post()
  async addToWatchlist(@Body() body: { symbol: string; note?: string }) {
    return this.watchlistService.addToWatchlist(body.symbol, body.note);
  }

  @Delete()
  async removeFromWatchlist(@Query('symbol') symbol: string) {
    const removed = await this.watchlistService.removeFromWatchlist(symbol);
    return { success: removed };
  }

  @Get('check')
  async checkWatchlist(@Query('symbol') symbol: string) {
    const isInWatchlist = await this.watchlistService.isInWatchlist(symbol);
    return { isInWatchlist };
  }
}
