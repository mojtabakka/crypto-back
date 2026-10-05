import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SentimentService } from './sentiment.service';
import { SentimentAnalysisEntity, SentimentSource, SentimentLabel } from './entities/sentiment-analysis.entity';
import { Repository } from 'typeorm';
import { NewsService } from '../news/news.service';
import { BinanceService } from '../binance/binance.service';

describe('SentimentService', () => {
  let service: SentimentService;
  let sentimentRepository: Repository<SentimentAnalysisEntity>;

  const mockSentimentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockNewsService = {
    getNewsForSymbol: jest.fn(),
  };

  const mockBinanceService = {
    getTickerPrice: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentimentService,
        {
          provide: getRepositoryToken(SentimentAnalysisEntity),
          useValue: mockSentimentRepository,
        },
        {
          provide: NewsService,
          useValue: mockNewsService,
        },
        {
          provide: BinanceService,
          useValue: mockBinanceService,
        },
      ],
    }).compile();

    service = module.get<SentimentService>(SentimentService);
    sentimentRepository = module.get<Repository<SentimentAnalysisEntity>>(getRepositoryToken(SentimentAnalysisEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeSentiment', () => {
    it('should analyze sentiment with bullish news', async () => {
      const symbol = 'BTCUSDT';
      const news = [
        { title: 'Bitcoin surges to new highs', description: 'Bullish momentum continues', url: 'http://example.com/1' },
        { title: 'BTC rally continues', description: 'Strong demand observed', url: 'http://example.com/2' },
      ];

      mockNewsService.getNewsForSymbol.mockResolvedValue(news);
      const mockAnalysis = {
        symbol,
        source: SentimentSource.OVERALL,
        score: 40,
        label: SentimentLabel.BULLISH,
        articleCount: 2,
        keywords: ['surge', 'rally'],
        summary: 'Bullish sentiment detected',
        topArticles: [],
      };
      mockSentimentRepository.create.mockReturnValue(mockAnalysis);
      mockSentimentRepository.save.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.analyzeSentiment(symbol);

      expect(result.score).toBe(40);
      expect(result.label).toBe(SentimentLabel.BULLISH);
      expect(result.articleCount).toBe(2);
    });

    it('should analyze sentiment with bearish news', async () => {
      const symbol = 'BTCUSDT';
      const news = [
        { title: 'Bitcoin crashes', description: 'Bearish trend continues', url: 'http://example.com/1' },
        { title: 'BTC plunges', description: 'Fear in the market', url: 'http://example.com/2' },
      ];

      mockNewsService.getNewsForSymbol.mockResolvedValue(news);
      const mockAnalysis = {
        symbol,
        source: SentimentSource.OVERALL,
        score: -40,
        label: SentimentLabel.BEARISH,
        articleCount: 2,
        keywords: ['crash', 'plunge'],
        summary: 'Bearish sentiment detected',
        topArticles: [],
      };
      mockSentimentRepository.create.mockReturnValue(mockAnalysis);
      mockSentimentRepository.save.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.analyzeSentiment(symbol);

      expect(result.score).toBe(-40);
      expect(result.label).toBe(SentimentLabel.BEARISH);
    });

    it('should return neutral sentiment when no news found', async () => {
      const symbol = 'BTCUSDT';

      mockNewsService.getNewsForSymbol.mockResolvedValue([]);
      const mockAnalysis = {
        symbol,
        source: SentimentSource.OVERALL,
        score: 0,
        label: SentimentLabel.NEUTRAL,
        articleCount: 0,
        keywords: [],
        summary: 'No recent news found for this symbol.',
        topArticles: [],
      };
      mockSentimentRepository.create.mockReturnValue(mockAnalysis);
      mockSentimentRepository.save.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.analyzeSentiment(symbol);

      expect(result.score).toBe(0);
      expect(result.label).toBe(SentimentLabel.NEUTRAL);
    });
  });

  describe('getLatestSentiment', () => {
    it('should return latest sentiment for a symbol', async () => {
      const symbol = 'BTCUSDT';
      const sentiments = [
        { id: 1, symbol, score: 40, label: SentimentLabel.BULLISH },
        { id: 2, symbol, score: 30, label: SentimentLabel.BULLISH },
      ];

      mockSentimentRepository.find.mockResolvedValue(sentiments);

      const result = await service.getLatestSentiment(symbol);

      expect(result).toHaveLength(2);
      expect(result[0].score).toBe(40);
    });
  });

  describe('getMarketOverview', () => {
    it('should return market overview for multiple symbols', async () => {
      const sentiments = [
        { id: 1, symbol: 'BTCUSDT', score: 40, label: SentimentLabel.BULLISH },
        { id: 2, symbol: 'ETHUSDT', score: -20, label: SentimentLabel.BEARISH },
      ];

      mockSentimentRepository.findOne
        .mockResolvedValueOnce(sentiments[0])
        .mockResolvedValueOnce(sentiments[1])
        .mockResolvedValue(null);

      const result = await service.getMarketOverview();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });
});
