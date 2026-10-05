import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertService } from './alert.service';
import {
  PriceAlertEntity,
  AlertStatus,
  AlertCondition,
} from './entities/price-alert.entity';
import { Repository } from 'typeorm';
import { BinanceService } from '../binance/binance.service';
import { NotificationGateway } from '../notification/notification.gateway';

describe('AlertService', () => {
  let service: AlertService;

  const mockAlertRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
  };

  const mockBinanceService = {
    getTickerPrice: jest.fn(),
  };

  const mockNotificationGateway = {
    sendPriceAlert: jest.fn(),
  };

  const buildEntity = (overrides: Partial<PriceAlertEntity> = {}) =>
    ({
      id: 1,
      username: 'admin',
      symbol: 'BTCUSDT',
      targetPrice: 50000,
      condition: AlertCondition.ABOVE,
      status: AlertStatus.ACTIVE,
      triggeredPrice: null,
      triggeredAt: null,
      expiresAt: null,
      note: null,
      ...overrides,
    }) as PriceAlertEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        {
          provide: getRepositoryToken(PriceAlertEntity),
          useValue: mockAlertRepository,
        },
        { provide: BinanceService, useValue: mockBinanceService },
        { provide: NotificationGateway, useValue: mockNotificationGateway },
      ],
    }).compile();

    service = module.get<AlertService>(AlertService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (service as any).isChecking = false;
  });

  describe('createAlert', () => {
    it('attaches the alert to the username from the token', async () => {
      const created = buildEntity();
      mockAlertRepository.create.mockReturnValue(created);
      mockAlertRepository.save.mockResolvedValue(created);

      const result = await service.createAlert('admin', {
        symbol: 'btcusdt',
        targetPrice: 50000,
        condition: AlertCondition.ABOVE,
      });

      expect(mockAlertRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', symbol: 'BTCUSDT' }),
      );
      expect(result.username).toBe('admin');
    });
  });

  describe('getUserAlerts', () => {
    it('scopes alerts to the given username', async () => {
      mockAlertRepository.find.mockResolvedValue([buildEntity()]);

      await service.getUserAlerts('admin');

      expect(mockAlertRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: 'admin' } }),
      );
    });

    it('filters by status when provided', async () => {
      mockAlertRepository.find.mockResolvedValue([]);

      await service.getUserAlerts('navid', AlertStatus.TRIGGERED);

      expect(mockAlertRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { username: 'navid', status: AlertStatus.TRIGGERED },
        }),
      );
    });
  });

  describe('ownership', () => {
    it('throws NotFound when the alert belongs to another user', async () => {
      mockAlertRepository.findOne.mockResolvedValue(null);

      await expect(service.getAlertById('navid', 1)).rejects.toThrow(
        'Alert not found',
      );
      expect(mockAlertRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, username: 'navid' },
      });
    });
  });

  describe('updateAlert', () => {
    it('updates allowed fields', async () => {
      const existing = buildEntity();
      mockAlertRepository.findOne.mockResolvedValue(existing);
      mockAlertRepository.save.mockImplementation(async (a) => a);

      const result = await service.updateAlert('admin', 1, { targetPrice: 60000 });

      expect(result.targetPrice).toBe(60000);
    });

    it('refuses to update a triggered alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(
        buildEntity({ status: AlertStatus.TRIGGERED }),
      );

      await expect(
        service.updateAlert('admin', 1, { targetPrice: 60000 }),
      ).rejects.toThrow('Cannot update a triggered alert');
    });
  });

  describe('cancelAlert', () => {
    it('cancels an active alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(buildEntity());
      mockAlertRepository.save.mockImplementation(async (a) => a);

      const result = await service.cancelAlert('admin', 1);

      expect(result.status).toBe(AlertStatus.CANCELLED);
    });

    it('refuses to cancel an already triggered alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(
        buildEntity({ status: AlertStatus.TRIGGERED }),
      );

      await expect(service.cancelAlert('admin', 1)).rejects.toThrow(
        'Only active alerts can be cancelled',
      );
    });
  });

  describe('checkAlerts', () => {
    it('triggers an "above" alert when the price is reached', async () => {
      mockAlertRepository.find.mockResolvedValue([
        buildEntity({ targetPrice: 50000, condition: AlertCondition.ABOVE }),
      ]);
      mockBinanceService.getTickerPrice.mockResolvedValue({
        symbol: 'BTCUSDT',
        price: 51000,
      });
      mockAlertRepository.save.mockImplementation(async (a) => a);

      await service.checkAlerts();

      expect(mockNotificationGateway.sendPriceAlert).toHaveBeenCalledTimes(1);
      expect(mockNotificationGateway.sendPriceAlert).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', currentPrice: 51000 }),
      );
    });

    it('does not trigger an "above" alert while the price is lower', async () => {
      mockAlertRepository.find.mockResolvedValue([
        buildEntity({ targetPrice: 50000, condition: AlertCondition.ABOVE }),
      ]);
      mockBinanceService.getTickerPrice.mockResolvedValue({
        symbol: 'BTCUSDT',
        price: 49000,
      });

      await service.checkAlerts();

      expect(mockNotificationGateway.sendPriceAlert).not.toHaveBeenCalled();
      expect(mockAlertRepository.save).not.toHaveBeenCalled();
    });

    it('triggers a "below" alert when the price drops through it', async () => {
      mockAlertRepository.find.mockResolvedValue([
        buildEntity({ targetPrice: 50000, condition: AlertCondition.BELOW }),
      ]);
      mockBinanceService.getTickerPrice.mockResolvedValue({
        symbol: 'BTCUSDT',
        price: 49500,
      });
      mockAlertRepository.save.mockImplementation(async (a) => a);

      await service.checkAlerts();

      expect(mockNotificationGateway.sendPriceAlert).toHaveBeenCalledTimes(1);
    });

    it('expires past-due alerts in a single batch', async () => {
      mockAlertRepository.find.mockResolvedValue([
        buildEntity({ expiresAt: new Date(Date.now() - 60_000) }),
      ]);
      mockAlertRepository.update.mockResolvedValue({ affected: 1 });

      await service.checkAlerts();

      expect(mockAlertRepository.update).toHaveBeenCalledTimes(1);
      expect(mockBinanceService.getTickerPrice).not.toHaveBeenCalled();
    });

    it('fetches the price once per symbol', async () => {
      mockAlertRepository.find.mockResolvedValue([
        buildEntity({ id: 1, targetPrice: 40000 }),
        buildEntity({ id: 2, targetPrice: 60000 }),
      ]);
      mockBinanceService.getTickerPrice.mockResolvedValue({
        symbol: 'BTCUSDT',
        price: 50000,
      });

      await service.checkAlerts();

      expect(mockBinanceService.getTickerPrice).toHaveBeenCalledTimes(1);
      expect(mockNotificationGateway.sendPriceAlert).toHaveBeenCalledTimes(1);
    });

    it('does not overlap runs', async () => {
      (service as any).isChecking = true;

      mockAlertRepository.find.mockResolvedValue([buildEntity()]);

      await service.checkAlerts();

      expect(mockAlertRepository.find).not.toHaveBeenCalled();
    });

    it('releases the lock even when the check throws', async () => {
      mockAlertRepository.find.mockRejectedValue(new Error('db down'));

      await service.checkAlerts();

      expect((service as any).isChecking).toBe(false);
    });
  });
});