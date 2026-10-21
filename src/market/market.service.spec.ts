import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';

describe('MarketService', () => {
  let service: MarketService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        {
          provide: ExchangeService,
          useValue: {
            getKlines: jest.fn().mockResolvedValue([]),
            getOpenInterest: jest.fn().mockResolvedValue([]),
            getFundingRate: jest.fn().mockResolvedValue([]),
            getLiquidationOrders: jest.fn().mockResolvedValue([]),
          },
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
