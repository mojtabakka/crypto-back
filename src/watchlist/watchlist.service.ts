import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistEntity } from './entities/watchlist.entity';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    @InjectRepository(WatchlistEntity)
    private readonly watchlistRepository: Repository<WatchlistEntity>,
  ) {}

  async addToWatchlist(symbol: string, note?: string): Promise<WatchlistEntity> {
    const existing = await this.watchlistRepository.findOne({ where: { symbol } });
    if (existing) {
      if (note) {
        existing.note = note;
        return this.watchlistRepository.save(existing);
      }
      return existing;
    }

    const entity = this.watchlistRepository.create({ symbol, note: note ?? null });
    return this.watchlistRepository.save(entity);
  }

  async removeFromWatchlist(symbol: string): Promise<boolean> {
    const result = await this.watchlistRepository.delete({ symbol });
    return (result.affected ?? 0) > 0;
  }

  async getWatchlist(): Promise<WatchlistEntity[]> {
    return this.watchlistRepository.find({ order: { createdAt: 'DESC' } });
  }

  async isInWatchlist(symbol: string): Promise<boolean> {
    const count = await this.watchlistRepository.count({ where: { symbol } });
    return count > 0;
  }
}
