import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { NewsService } from './news.service';

const mockParseURL = jest.fn();

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL,
  }));
});

jest.mock('axios');

describe('NewsService', () => {
  let service: NewsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NewsService],
    }).compile();

    service = module.get<NewsService>(NewsService);
  });

  afterEach(() => {
    mockParseURL.mockReset();
    jest.mocked(axios).get.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('RSS News', () => {
    it('should fetch and map articles from RSS feeds', async () => {
      mockParseURL.mockResolvedValue({
        title: 'Test Feed',
        items: [
          {
            title: 'Bitcoin Price Surges',
            link: 'https://example.com/btc',
            contentSnippet: 'BTC hits new high',
            isoDate: new Date('2025-01-02').toISOString(),
            categories: ['Markets'],
          },
          {
            title: 'ETH Upgrade Complete',
            link: 'https://example.com/eth',
            contentSnippet: 'Ethereum network upgrade done',
            isoDate: new Date('2025-01-01').toISOString(),
            categories: ['Technology'],
          },
        ],
      });

      const result = await service.getNews({ limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data.length).toBe(5);
      expect(result.data[0].title).toBe('Bitcoin Price Surges');
      expect(result.data[0].source).toBe('Cointelegraph');
    });

    it('should filter articles by symbol keyword', async () => {
      mockParseURL.mockResolvedValue({
        title: 'Test Feed',
        items: [
          {
            title: 'Bitcoin ETF Approved',
            link: 'https://example.com/btc',
            contentSnippet: 'BTC spot ETF approved by SEC',
            isoDate: new Date().toISOString(),
            categories: [],
          },
          {
            title: 'Ethereum Layer 2 Boom',
            link: 'https://example.com/eth',
            contentSnippet: 'ETH scaling adoption grows',
            isoDate: new Date().toISOString(),
            categories: [],
          },
        ],
      });

      const result = await service.getNews({ symbol: 'BTC', limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data.length).toBe(3);
      expect(result.data[0].title).toContain('Bitcoin');
    });

    it('should return empty data when no articles match symbol', async () => {
      mockParseURL.mockResolvedValue({
        title: 'Test Feed',
        items: [
          {
            title: 'Bitcoin Price Moves',
            link: 'https://example.com/btc',
            contentSnippet: 'BTC analysis',
            isoDate: new Date().toISOString(),
            categories: [],
          },
        ],
      });

      const result = await service.getNews({ symbol: 'DOGE', limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data).toEqual([]);
      expect(result.hasWarning).toBe(true);
    });

    it('should handle RSS feed fetch errors gracefully', async () => {
      mockParseURL.mockRejectedValue(new Error('Network error'));

      const result = await service.getNews({ limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data).toEqual([]);
      expect(result.hasWarning).toBe(true);
    });
  });

  describe('CoinMarketCal Events', () => {
    it('should fetch and map events from CoinMarketCal API', async () => {
      const mockedAxios = jest.mocked(axios);
      mockedAxios.get.mockResolvedValue({
        data: {
          status: 'success',
          result: {
            data: [
              {
                id: '1',
                title: 'Bitcoin Halving',
                description: 'Next BTC halving event',
                coinName: 'Bitcoin',
                coinSymbol: 'BTC',
                date: '2025-01-01',
                source: 'CoinMarketCal',
                sourceUrl: 'https://example.com/event/1',
                tags: [{ name: 'mining' }, { name: 'supply' }],
              },
              {
                id: '2',
                title: 'ETH Shanghai',
                description: 'Ethereum Shanghai upgrade',
                coinName: 'Ethereum',
                coinSymbol: 'ETH',
                date: '2024-04-12',
                source: 'CoinMarketCal',
                sourceUrl: 'https://example.com/event/2',
                tags: [{ name: 'upgrade' }],
              },
            ],
          },
        },
      });

      const result = await service.getEvents({ limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data.length).toBe(2);
      expect(result.data[0].title).toBe('Bitcoin Halving');
      expect(result.data[0].source).toBe('CoinMarketCal');
      expect(result.data[0].coinName).toBe('Bitcoin');
      expect(result.data[0].coinSymbol).toBe('BTC');
      expect(result.data[0].tags).toBe('mining,supply');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.coinmarketcal.com/v2/events',
        expect.objectContaining({
          params: { limit: 5 },
          timeout: 10000,
        }),
      );
    });

    it('should filter events by symbol', async () => {
      const mockedAxios = jest.mocked(axios);
      mockedAxios.get.mockResolvedValue({
        data: {
          status: 'success',
          result: {
            data: [
              {
                id: '1',
                title: 'Bitcoin Halving',
                description: 'Next BTC halving',
                coinName: 'Bitcoin',
                coinSymbol: 'BTC',
                date: '2025-01-01',
                source: 'CoinMarketCal',
                sourceUrl: 'https://example.com/1',
                tags: [],
              },
            ],
          },
        },
      });

      const result = await service.getEvents({ symbol: 'BTC', limit: 5 });

      expect(result.status).toBe('success');
      expect(result.data.length).toBe(1);
      expect(result.data[0].coinSymbol).toBe('BTC');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            coins: 'Bitcoin',
          }),
        }),
      );
    });

    it('should return empty data on API failure', async () => {
      const mockedAxios = jest.mocked(axios);
      mockedAxios.get.mockRejectedValue(new Error('API error'));

      const result = await service.getEvents({ limit: 5 });

      expect(result.status).toBe('error');
      expect(result.data).toEqual([]);
      expect(result.hasWarning).toBe(true);
    });
  });
});
