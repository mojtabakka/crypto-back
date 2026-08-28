import { Test, TestingModule } from '@nestjs/testing';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';

describe('MarketController', () => {
  let controller: MarketController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [
        {
          provide: MarketService,
          useValue: {},
        },
        {
          provide: LiquidationService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<MarketController>(MarketController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
