import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';

import { NewListingEntity, ListingStatus } from './entities/new-listing.entity';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { FuturesSymbolEntity } from 'src/futures-symbols/entities/futures-symbol.entity';

interface TradingViewNewsItem {
  id: string;
  title: string;
  description?: string;
  short_description?: string;
  source?: string;
  link?: string;
  url?: string;
  story_path?: string;
  published?: number;
  related_symbols?: Array<{ symbol: string }>;
}

interface TradingViewNewsResponse {
  items: TradingViewNewsItem[];
}

@Injectable()
export class NewListingsService implements OnModuleInit {
  private readonly logger = new Logger(NewListingsService.name);

  private readonly TRADINGVIEW_NEWS_URL =
    'https://news-headlines.tradingview.com/v2/headlines';

  private readonly LISTING_KEYWORDS = [
    'will list',
    'lists',
    'listing',
    'to be listed',
    'to list',
    'adding',
    'adds',
    'new listing',
    'spot listing',
    'futures listing',
    'perpetual',
    'supports',
    'will support',
    'will add',
    'to add',
    'launching',
    'to launch',
    'will launch',
  ];

  private readonly EXCHANGE_KEYWORDS = [
    'binance',
    'bybit',
    'okx',
    'kraken',
    'coinbase',
    'kucoin',
    'gate.io',
    'gate',
    'mexc',
    'bitget',
    'htx',
    'huobi',
    'bitfinex',
    'deribit',
    'bitstamp',
  ];

  constructor(
    @InjectRepository(NewListingEntity)
    private readonly newListingRepository: Repository<NewListingEntity>,
    @InjectRepository(FuturesSymbolEntity)
    private readonly futuresSymbolRepository: Repository<FuturesSymbolEntity>,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  onModuleInit() {
    this.fetchNewListings().catch((err) =>
      this.logger.error('Initial fetch failed', err),
    );
  }

  async fetchNewListings(): Promise<NewListingEntity[]> {
    this.logger.log('Fetching listing news from TradingView...');

    const newListings: NewListingEntity[] = [];

    try {
      const listingNews = await this.fetchAllListingNews();

      for (const news of listingNews) {
        const symbols = this.extractSymbols(news.title);
        const exchange = this.extractExchange(news.title);
        const extractedDate = this.extractListingDate(news.title);

        for (const symbol of symbols) {
          const existing = await this.newListingRepository.findOne({
            where: { symbol, exchange },
          });

          if (!existing) {
            const listing = new NewListingEntity();
            listing.symbol = symbol;
            listing.exchange = exchange;
            listing.name = null;
            listing.listedDate = extractedDate
              ? extractedDate
              : news.published
                ? news.published * 1000
                : Date.now();
            listing.status = this.getStatus(news.title);
            listing.announcementUrl =
              news.link ?? news.url ?? news.story_path ?? null;
            listing.description =
              news.description ?? news.short_description ?? null;

            const saved = await this.newListingRepository.save(listing);
            newListings.push(saved);

            this.notificationGateway.sendNewListing({
              symbol,
              exchange,
              listedDate: listing.listedDate,
              title: news.title,
            });
          }
        }
      }

      this.logger.log(`Found ${newListings.length} new listings from news`);
      return newListings;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to fetch listing news:', errorMsg);
      return [];
    }
  }

  private async fetchAllListingNews(): Promise<TradingViewNewsItem[]> {
    const allNews: TradingViewNewsItem[] = [];
    const seenIds = new Set<string>();

    const symbols = await this.getSymbolsFromDatabase();

    this.logger.log(`Checking ${symbols.length} symbols for listing news...`);

    const batchSize = 3;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      const promises = batch.map((symbol) => this.fetchNewsForSymbol(symbol));

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const item of result.value) {
            if (!seenIds.has(item.id) && this.isListingNews(item.title)) {
              seenIds.add(item.id);
              allNews.push(item);
            }
          }
        }
      }

      if (i + batchSize < symbols.length) {
        await this.delay(500);
      }
    }

    return allNews;
  }

  private async fetchNewsForSymbol(
    symbol: string,
  ): Promise<TradingViewNewsItem[]> {
    const items: TradingViewNewsItem[] = [];

    try {
      const response = await axios.get<TradingViewNewsResponse>(
        this.TRADINGVIEW_NEWS_URL,
        {
          params: {
            symbol: `${symbol}USDT`,
            client: 'web',
            lang: 'en',
            locale: 'en',
            country: 'US',
          },
          timeout: 5000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        },
      );

      items.push(...(response.data?.items ?? []));
    } catch {
      // Symbol not found on exchange, skip
    }

    return items;
  }

  private async getSymbolsFromDatabase(): Promise<string[]> {
    const symbols = await this.futuresSymbolRepository
      .createQueryBuilder('fs')
      .select('DISTINCT fs.symbol', 'symbol')
      .where('fs.quoteAsset = :quote', { quote: 'USDT' })
      .andWhere('fs.status = :status', { status: 'TRADING' })
      .getRawMany<{ symbol: string }>();

    return symbols.map((s) => s.symbol);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isListingNews(title: string): boolean {
    const lowerTitle = title.toLowerCase();

    const hasListingKeyword = this.LISTING_KEYWORDS.some((kw) =>
      lowerTitle.includes(kw),
    );
    const hasExchangeKeyword = this.EXCHANGE_KEYWORDS.some((kw) =>
      lowerTitle.includes(kw),
    );

    return hasListingKeyword && hasExchangeKeyword;
  }

  private extractSymbols(title: string): string[] {
    const symbols: string[] = [];

    const patterns = [
      /(?:will list|lists|listing|to be listed|to list|adding|adds|will add|to add|launching|to launch|will launch|supports|will support)\s+\(?([A-Z0-9]{2,10})\)?/i,
      /([A-Z0-9]{2,10})\s+(?:will be listed|to be listed|listing|listed|added|added to)/i,
      /([A-Z0-9]{2,10})\s+(?:perpetual|futures|spot)\s+(?:trading|listing|pair)/i,
      /(?:spot|futures)\s+(?:listing|trading|pair)\s+(?:of|for)\s+([A-Z0-9]{2,10})/i,
    ];

    const excludeWords = new Set([
      'USDT',
      'USD',
      'BTC',
      'ETH',
      'THE',
      'AND',
      'FOR',
      'WILL',
      'BEEN',
      'THIS',
      'THAT',
      'WITH',
      'FROM',
      'HAVE',
      'HAS',
      'HAD',
      'WAS',
      'WERE',
      'ARE',
      'BEING',
      'LIST',
      'LISTING',
      'LISTED',
      'ADD',
      'ADDING',
      'ADDED',
      'LAUNCH',
      'LAUNCHING',
      'LAUNCHED',
      'SUPPORT',
      'SUPPORTING',
      'SUPPORTED',
      'TRADING',
      'TRADER',
      'TRADERS',
      'EXCHANGE',
      'MARKET',
      'MARKETS',
      'SPOT',
      'FUTURES',
      'PERPETUAL',
      'CONTRACT',
      'CONTRACTS',
      'PAIR',
      'PAIRS',
      'NEW',
      'NOW',
      'ALSO',
      'JUST',
      'ABOUT',
      'AFTER',
      'BEFORE',
      'OVER',
      'UNDER',
      'INTO',
      'ONTO',
      'CRYPTO',
      'COIN',
      'TOKEN',
      'ASSET',
      'ASSETS',
      'PROJECT',
      'PLATFORM',
      'NETWORK',
      'CHAIN',
      'PROTOCOL',
      'FINANCE',
      'DEFI',
      'NFT',
      'DAO',
      'WEB3',
      'WALLET',
      'METAVERSE',
      'GAMING',
      'AI',
      'MEME',
    ]);

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match?.[1]) {
        const symbol = match[1].toUpperCase();
        if (
          symbol.length >= 2 &&
          symbol.length <= 10 &&
          !excludeWords.has(symbol) &&
          !symbols.includes(symbol)
        ) {
          symbols.push(symbol);
        }
      }
    }

    return symbols;
  }

  private extractExchange(title: string): string {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('binance')) return 'BINANCE';
    if (lowerTitle.includes('bybit')) return 'BYBIT';
    if (lowerTitle.includes('okx')) return 'OKX';
    if (lowerTitle.includes('kraken')) return 'KRAKEN';
    if (lowerTitle.includes('coinbase')) return 'COINBASE';
    if (lowerTitle.includes('kucoin')) return 'KUCOIN';
    if (lowerTitle.includes('gate.io') || lowerTitle.includes('gate '))
      return 'GATE';
    if (lowerTitle.includes('mexc')) return 'MEXC';
    if (lowerTitle.includes('bitget')) return 'BITGET';
    if (lowerTitle.includes('htx') || lowerTitle.includes('huobi'))
      return 'HTX';
    if (lowerTitle.includes('bitfinex')) return 'BITFINEX';
    if (lowerTitle.includes('deribit')) return 'DERIBIT';
    if (lowerTitle.includes('bitstamp')) return 'BITSTAMP';

    return 'UNKNOWN';
  }

  private getStatus(title: string): ListingStatus {
    const lowerTitle = title.toLowerCase();
    if (
      lowerTitle.includes('will list') ||
      lowerTitle.includes('to list') ||
      lowerTitle.includes('to be listed') ||
      lowerTitle.includes('will add') ||
      lowerTitle.includes('to add') ||
      lowerTitle.includes('will launch') ||
      lowerTitle.includes('to launch') ||
      lowerTitle.includes('will support')
    ) {
      return 'UPCOMING';
    }
    if (
      lowerTitle.includes('lists') ||
      lowerTitle.includes('adds') ||
      lowerTitle.includes('listed') ||
      lowerTitle.includes('added') ||
      lowerTitle.includes('launched') ||
      lowerTitle.includes('supports')
    ) {
      return 'TRADING';
    }
    return 'NEW';
  }

  private extractListingDate(title: string): number | null {
    const datePatterns = [
      /(?:on|at)\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
      /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s*(\d{4}))?/i,
      /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
    ];

    const months: Record<string, number> = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    for (const pattern of datePatterns) {
      const match = title.match(pattern);
      if (match) {
        let month: number | undefined;
        let day: number | undefined;
        let year: number | undefined;

        if (match[1] && months[match[1].toLowerCase()] !== undefined) {
          month = months[match[1].toLowerCase()];
          day = parseInt(match[2], 10);
          year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        } else if (match[2] && months[match[2].toLowerCase()] !== undefined) {
          day = parseInt(match[1], 10);
          month = months[match[2].toLowerCase()];
          year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        }

        if (month !== undefined && day !== undefined && year !== undefined) {
          const date = new Date(year, month, day);
          if (!isNaN(date.getTime())) {
            return date.getTime();
          }
        }
      }
    }

    return null;
  }

  async getRecentListings(days = 30): Promise<NewListingEntity[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    return this.newListingRepository.find({
      where: { listedDate: since },
      order: { listedDate: 'DESC' },
      take: 100,
    });
  }

  async getListingsByStatus(
    status: ListingStatus,
  ): Promise<NewListingEntity[]> {
    const now = Date.now();

    return this.newListingRepository.find({
      where: { status, listedDate: now },
      order: { listedDate: 'ASC' },
      take: 50,
    });
  }

  async getUpcomingListings(): Promise<NewListingEntity[]> {
    const now = Date.now();

    return this.newListingRepository
      .createQueryBuilder('nl')
      .where('nl.status = :status', { status: 'UPCOMING' })
      .andWhere('nl.listedDate > :now', { now })
      .orderBy('nl.listedDate', 'ASC')
      .take(50)
      .getMany();
  }

  async getAllListings(
    page = 1,
    limit = 20,
    status?: ListingStatus,
  ): Promise<{
    data: NewListingEntity[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const now = Date.now();
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    } else {
      where.status = 'UPCOMING';
    }

    const [data, total] = await this.newListingRepository
      .createQueryBuilder('nl')
      .where(where)
      .andWhere('nl.listedDate > :now', { now })
      .orderBy('nl.listedDate', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
