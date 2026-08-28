import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    service = new RedisService();
  });

  describe('getHealthy', () => {
    it('should return false before connection', () => {
      expect(service.getHealthy()).toBe(false);
    });
  });

  describe('get/set', () => {
    it('should return null for missing key when not connected', async () => {
      const result = await service.get('missing-key');
      expect(result).toBeNull();
    });

    it('should return empty array for lrange when not connected', async () => {
      const result = await service.lrange('missing-key', 0, -1);
      expect(result).toEqual([]);
    });

    it('should return 0 for lpush when not connected', async () => {
      const result = await service.lpush('missing-key', 'value');
      expect(result).toBe(0);
    });

    it('should return empty object for getJson when not connected', async () => {
      const result = await service.getJson('missing-key');
      expect(result).toBeNull();
    });
  });
});
