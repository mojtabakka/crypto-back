import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { BinanceService } from 'src/binance/binance.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import { ExchangeService } from 'src/exchange/exchange.service';

describe('MarketService', () => {
  let service: MarketService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        {
          provide: ExchangeService,
          useValue: {
            getKlines: jest.fn(),
            getFuturesKlines: jest.fn(),
            getOpenInterest: jest.fn(),
            getFundingRate: jest.fn(),
            getLiquidationOrders: jest.fn(),
          },
        },
        {
          provide: BinanceService,
          useValue: {},
        },
        {
          provide: LiquidationService,
          useValue: {
            getLiquidations: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<MarketService>(MarketService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
