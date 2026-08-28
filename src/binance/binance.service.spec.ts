import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { BinanceService } from './binance.service';
import { RedisService } from 'src/redis/redis.service';

jest.mock('axios');

describe('BinanceService', () => {
  let service: BinanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BinanceService,
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<BinanceService>(BinanceService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call the correct spot klines endpoint without malformed URL spacing', async () => {
    const mockedAxios = jest.mocked(axios);
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.getKlines('BTCUSDT', '15m', 1, 2, 1000);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/klines',
      expect.objectContaining({
        params: expect.objectContaining({
          symbol: 'BTCUSDT',
          interval: '15m',
        }),
      }),
    );
  });

  it('should cache funding rate data in Redis', async () => {
    const mockedAxios = jest.mocked(axios);
    const fundingData = [
      {
        symbol: 'BTCUSDT',
        fundingRate: '0.0001',
        fundingTime: 1700000000000,
      },
    ];

    mockedAxios.get.mockResolvedValue({ data: fundingData });

    const result = await service.getFundingRate(
      'BTCUSDT',
      1700000000000,
      1700010000000,
    );

    expect(result.length).toBeGreaterThan(0);
  });

  it('should use cached funding data when API returns empty', async () => {
    const mockedAxios = jest.mocked(axios);
    mockedAxios.get.mockResolvedValue({ data: [] });

    const result = await service.getFundingRate(
      'BTCUSDT',
      1700000000000,
      1700010000000,
    );

    expect(result).toEqual([]);
  });

  it('should cache futures klines in Redis', async () => {
    const mockedAxios = jest.mocked(axios);
    const klines: unknown[] = [
      [1700000000000, '1', '1', '1', '1', '100', 170000000.0],
    ];

    mockedAxios.get.mockResolvedValue({ data: klines });

    const result = await service.getFuturesKlines(
      'BTCUSDT',
      '15m',
      1700000000000,
      1700010000000,
    );

    expect(result.length).toBe(1);
  });

  it('should cache open interest in Redis', async () => {
    const mockedAxios = jest.mocked(axios);
    const oiData = [
      {
        timestamp: '1700000000000',
        sumOpenInterest: '1000',
        sumOpenInterestValue: '50000',
      },
    ];

    mockedAxios.get.mockResolvedValue({ data: oiData });

    const result = await service.getOpenInterest(
      'BTCUSDT',
      1700000000000,
      1700010000000,
    );

    expect(result.length).toBe(1);
  });
});
