import { Test, TestingModule } from '@nestjs/testing';
import { MarketSignalController } from './market-signal.controller';
import { MarketSignalService } from './market-signal.service';
import { BinanceService } from 'src/binance/binance.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import { RedisService } from 'src/redis/redis.service';

describe('MarketSignalController', () => {
  let controller: MarketSignalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketSignalController],
      providers: [
        MarketSignalService,
        {
          provide: BinanceService,
          useValue: {
            getFuturesKlines: jest.fn(),
            getOpenInterest: jest.fn(),
            getFundingRate: jest.fn(),
            getLiquidationOrders: jest.fn(),
          },
        },
        {
          provide: LiquidationService,
          useValue: {
            getLiquidations: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            getHealthy: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    controller = module.get<MarketSignalController>(MarketSignalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
