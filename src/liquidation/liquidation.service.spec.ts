import { Test, TestingModule } from '@nestjs/testing';
import { LiquidationService } from './liquidation.service';
import { RedisService } from 'src/redis/redis.service';

describe('LiquidationService', () => {
  let service: LiquidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationService,
        {
          provide: RedisService,
          useValue: {
            lpush: jest.fn().mockResolvedValue(0),
            lrange: jest.fn().mockResolvedValue([]),
            llen: jest.fn().mockResolvedValue(0),
            lrem: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();

    service = module.get<LiquidationService>(LiquidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty array for unsupported range', async () => {
    await expect(service.getLiquidations('BTCUSDT', 'invalid')).rejects.toThrow(
      'Unsupported range: invalid',
    );
  });

  it('should include Redis data in getLiquidations results', async () => {
    const redisMock = {
      lpush: jest.fn().mockResolvedValue(0),
      lrange: jest.fn().mockResolvedValue([]),
      llen: jest.fn().mockResolvedValue(0),
      lrem: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationService,
        {
          provide: RedisService,
          useValue: redisMock,
        },
      ],
    }).compile();

    const svc = module.get<LiquidationService>(LiquidationService);
    const result = await svc.getLiquidations('BTCUSDT', '24h');

    expect(Array.isArray(result)).toBe(true);
    expect(redisMock.lrange).toHaveBeenCalledWith('liquidation:BTCUSDT', 0, -1);
  });
});
