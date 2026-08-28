import { Test, TestingModule } from '@nestjs/testing';
import { MarketService } from './market.service';
import { BinanceService } from 'src/binance/binance.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';

describe('MarketService', () => {
  let service: MarketService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
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
