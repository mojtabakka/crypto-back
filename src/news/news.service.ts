import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import Parser from 'rss-parser';

import {
  CryptoEventItem,
  CryptoEventResponse,
  CryptoNewsItem,
  CryptoNewsResponse,
  EventsQueryDto,
  NewsQueryDto,
  TradingViewNewsItem,
  TradingViewNewsResponse,
  TradingViewRawResponse,
} from './news.types';

interface FeedSource {
  name: string;
  url: string;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  private readonly parser = new Parser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  private readonly SYMBOL_KEYWORDS: Record<string, string[]> = {
    BTC: ['bitcoin', 'btc', 'بیت‌کوین', 'بیت کوین'],
    ETH: ['ethereum', 'eth', 'اتریوم'],
    TON: ['toncoin', 'ton', 'تون'],
    SOL: ['solana', 'sol', 'سولانا'],
    ADA: ['cardano', 'ada'],
    XRP: ['xrp', 'ریپل'],
    DOT: ['polkadot', 'dot', 'پولکادات'],
    AVAX: ['avalanche', 'avax'],
    MATIC: ['polygon', 'matic'],
    LINK: ['chainlink', 'link'],
    UNI: ['uniswap', 'uni'],
    LTC: ['litecoin', 'ltc'],
    DOGE: ['dogecoin', 'doge'],
    SHIB: ['shiba', 'shib'],
    AAVE: ['aave'],
    NEAR: ['near'],
  };

  private readonly TRADINGVIEW_NEWS_URL =
    'https://news-headlines.tradingview.com/v2/headlines';

  private readonly TRANSLATE_URL =
    'https://api.mymemory.translated.net/get';

  private async translateToPersian(text: string): Promise<string> {
    if (!text || text.trim().length === 0) return '';

    try {
      const response = await axios.get(this.TRANSLATE_URL, {
        params: {
          q: text,
          langpair: 'en|fa',
        },
        timeout: 5000,
      });

      const translated = response.data?.responseData?.translatedText;
      return translated || text;
    } catch {
      return text;
    }
  }

  private async fetchTradingViewNews(symbol: string, limit: number, lang?: string): Promise<TradingViewNewsResponse> {
    if (!symbol) {
      return {
        status: 'error',
        hasWarning: true,
        message: 'Symbol is required',
        symbol: '',
        data: [],
      };
    }

    const normalizedSymbol = symbol.replace(/USD$/i, '').replace(/USDT$/i, '').toUpperCase();
    const tvSymbol = `BINANCE:${normalizedSymbol}USDT`;

    try {
      const response = await axios.get<TradingViewRawResponse>(this.TRADINGVIEW_NEWS_URL, {
        params: {
          symbol: tvSymbol,
          client: 'web',
          lang: 'en',
          locale: 'en',
          country: 'US',
        },
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      const items = response.data?.items ?? [];

      const translatedItems = await Promise.all(
        items.slice(0, limit).map(async (item) => {
          let title = item.title ?? '';
          let description = item.description ?? item.short_description ?? '';

          if (lang === 'fa') {
            title = await this.translateToPersian(title);
            if (description) {
              description = await this.translateToPersian(description);
            }
          }

          return {
            id: item.id ?? '',
            title,
            description,
            source: item.source ?? 'TradingView',
            url: item.link ?? item.url ?? item.story_path ?? '',
            publishedOn: item.published ? item.published * 1000 : 0,
            tags: item.related_symbols?.map((s) => s.symbol).join(',') ?? '',
            imageUrl: item.thumbnail?.url ?? item.avatar_url ?? '',
          };
        }),
      );

      return {
        status: 'success',
        hasWarning: translatedItems.length === 0,
        message: translatedItems.length === 0 ? 'No news found for this symbol.' : '',
        symbol: normalizedSymbol,
        data: translatedItems,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to fetch TradingView news:', errorMsg);

      return {
        status: 'error',
        hasWarning: true,
        message: errorMsg,
        symbol: normalizedSymbol,
        data: [],
      };
    }
  }

  async getTradingViewNews(symbol: string, limit = 20, lang?: string): Promise<TradingViewNewsResponse> {
    return this.fetchTradingViewNews(symbol, limit, lang);
  }

  private readonly IMPORTANT_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
  ];

  async getImportantNews(limit = 30, lang?: string): Promise<TradingViewNewsResponse> {
    const allNews: TradingViewNewsItem[] = [];

    const newsResults = await Promise.allSettled(
      this.IMPORTANT_SYMBOLS.map((symbol) => this.fetchTradingViewNews(symbol, 5, lang)),
    );

    for (const result of newsResults) {
      if (result.status === 'fulfilled' && result.value.data) {
        allNews.push(...result.value.data);
      }
    }

    const uniqueNews = Array.from(
      new Map(allNews.map((item) => [item.id, item])).values(),
    );

    uniqueNews.sort((a, b) => b.publishedOn - a.publishedOn);

    return {
      status: 'success',
      hasWarning: uniqueNews.length === 0,
      message: uniqueNews.length === 0 ? 'No news found' : '',
      symbol: 'ALL',
      data: uniqueNews.slice(0, limit),
    };
  }

  private readonly FEEDS: FeedSource[] = [
    { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
    {
      name: 'Cointelegraph Bitcoin',
      url: 'https://cointelegraph.com/tags/bitcoin.rss',
    },
    {
      name: 'Cointelegraph Ethereum',
      url: 'https://cointelegraph.com/tags/ethereum.rss',
    },
  ];

  private readonly COINMARKETCAL_URL =
    'https://api.coinmarketcal.com/v2/events';

  private readonly COINMARKETCAL_API_KEY =
    process.env.CMC_API_KEY ?? 'cmc_live_019f6f114b7983c7860b0909e12c660f';

  private readonly SYMBOL_TO_CMC_NAME: Record<string, string> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    TON: 'Toncoin',
    SOL: 'Solana',
    ADA: 'Cardano',
    XRP: 'XRP',
    DOT: 'Polkadot',
    AVAX: 'Avalanche',
    MATIC: 'Polygon',
    LINK: 'Chainlink',
    UNI: 'Uniswap',
    LTC: 'Litecoin',
    DOGE: 'Dogecoin',
    SHIB: 'Shiba Inu',
    AAVE: 'Aave',
    NEAR: 'Near',
  };

  private readonly SYMBOL_TO_CMC_SLUG: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    TON: 'toncoin',
    SOL: 'solana',
    ADA: 'cardano',
    XRP: 'xrp',
    DOT: 'polkadot',
    AVAX: 'avalanche',
    MATIC: 'polygon',
    LINK: 'chainlink',
    UNI: 'uniswap',
    LTC: 'litecoin',
    DOGE: 'dogecoin',
    SHIB: 'shiba-inu',
    AAVE: 'aave',
    NEAR: 'near-protocol',
  };

  async getNews(query: NewsQueryDto = {}): Promise<CryptoNewsResponse> {
    const { symbol, limit = 50 } = query;

    const allArticles: CryptoNewsItem[] = [];

    for (const feed of this.FEEDS) {
      const articles = await this.fetchFeed(feed.name, feed.url);

      allArticles.push(...articles);
    }

    const filtered = this.filterBySymbol(allArticles, symbol);

    const sorted = filtered
      .sort((a, b) => b.publishedOn - a.publishedOn)
      .slice(0, limit);

    return {
      status: 'success',
      hasWarning: sorted.length === 0,
      message:
        sorted.length === 0 ? 'No crypto news found for this symbol.' : '',
      data: sorted,
    };
  }

  async getEvents(query: EventsQueryDto = {}): Promise<CryptoEventResponse> {
    const { symbol, limit = 50, lang } = query;

    try {
      let events = await this.fetchEvents(symbol, limit);

      if (lang === 'fa' && events.length > 0) {
        events = await Promise.all(
          events.map(async (event) => ({
            ...event,
            title: await this.translateToPersian(event.title),
            description: event.description
              ? await this.translateToPersian(event.description)
              : event.description,
          })),
        );
      }

      return {
        status: 'success',
        hasWarning: events.length === 0,
        message:
          events.length === 0 ? 'No crypto events found for this symbol.' : '',
        data: events,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.logger.error('Failed to fetch crypto events:', errorMsg);

      return {
        status: 'error',
        hasWarning: true,
        message: errorMsg,
        data: [],
      };
    }
  }

  private async fetchEvents(
    symbol: string | undefined,
    limit: number,
  ): Promise<CryptoEventItem[]> {
    const coins = this.resolveCoins(symbol);

    const params: Record<string, string | number> = { limit };

    if (coins) {
      params.coins = coins;
    }

    const headers: Record<string, string> = {
      'x-api-key': this.COINMARKETCAL_API_KEY,
    };

    const response = await axios.get<{
      data?: Array<{
        id: string;
        title: string;
        description?: string;
        date?: string;
        dateEnd?: string;
        displayedDate?: string;
        coins?: Array<{ slug: string; symbol: string; name: string }>;
        sourceUrl?: string;
        impact?: number | null;
      }>;
    }>(this.COINMARKETCAL_URL, { params, headers, timeout: 10000 });

    const rawEvents = response.data?.data ?? [];

    return rawEvents.slice(0, limit).map((event): CryptoEventItem => {
      const coinNames = event.coins?.map((c) => c.name).join(', ') ?? '';
      const coinSymbols = event.coins?.map((c) => c.symbol).join(', ') ?? '';

      return {
        id: String(event.id ?? ''),
        title: this.cleanText(event.title ?? ''),
        description: this.cleanText(event.description ?? ''),
        source: 'CoinMarketCal',
        url: event.sourceUrl ?? '',
        publishedOn: event.date ? Date.parse(event.date) : 0,
        tags: coinNames,
        coinName: coinNames,
        coinSymbol: coinSymbols,
      };
    });
  }

  private resolveCoins(symbol: string | undefined): string {
    if (!symbol) {
      return '';
    }

    const normalized = symbol
      .replace(/USD$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase();

    const coinSlug = this.SYMBOL_TO_CMC_SLUG[normalized];

    if (coinSlug) {
      return coinSlug;
    }

    return normalized.toLowerCase();
  }

  private async fetchFeed(
    source: string,
    rssUrl: string,
  ): Promise<CryptoNewsItem[]> {
    try {
      const feed = await this.parser.parseURL(rssUrl);

      if (!feed.items || !Array.isArray(feed.items)) {
        return [];
      }

      return feed.items.map((item): CryptoNewsItem => {
        const isoDate = item.isoDate ?? item.pubDate ?? '';

        const publishedOn = isoDate ? Date.parse(isoDate) : 0;

        return {
          id: String(item.id ?? item.link ?? ''),
          title: this.cleanText(item.title ?? ''),
          description: this.cleanText(
            item.contentSnippet ?? item.content ?? '',
          ),
          source,
          url: item.link ?? '',
          publishedOn,
          tags: item.categories?.join(',') ?? '',
          categories: '',
          originalImageUrl: undefined,
        };
      });
    } catch (error) {
      this.logger.warn(
        `Failed to fetch feed from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  }

  private filterBySymbol(
    articles: CryptoNewsItem[],
    symbol?: string,
  ): CryptoNewsItem[] {
    if (!symbol) {
      return articles;
    }

    const normalizedSymbol = symbol
      .replace(/USD$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase();

    const keywords = this.SYMBOL_KEYWORDS[normalizedSymbol] ?? [
      normalizedSymbol,
      normalizedSymbol.toLowerCase(),
    ];

    return articles.filter((article) => {
      const text = `${article.title} ${article.description}`.toLowerCase();

      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }

  private cleanText(text: string): string {
    if (!text) return '';

    return text.replace(/<[^>]+>/g, '').trim();
  }
}
