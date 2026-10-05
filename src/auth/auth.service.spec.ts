import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersStoreService, StoredUser } from './users-store.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockUsersStore = {
    findByUsername: jest.fn(),
    getUsers: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const adminUser: StoredUser = {
    username: 'admin',
    password: 'admin',
    role: 'admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersStoreService,
          useValue: mockUsersStore,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(adminUser);
      mockJwtService.signAsync.mockResolvedValue('token');

      const result = await service.login({ username: 'admin', password: 'admin' });

      expect(result.user.username).toBe('admin');
      expect(result.user.role).toBe('admin');
      expect('password' in result.user).toBe(false);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow('Invalid username or password');
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(adminUser);

      await expect(
        service.login({ username: 'admin', password: 'wrong' }),
      ).rejects.toThrow('Invalid username or password');
    });

    it('should never expose the password in the response', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(adminUser);
      mockJwtService.signAsync.mockResolvedValue('token');

      const result = await service.login({ username: 'admin', password: 'admin' });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('password');
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
      const payload = { sub: 'admin', username: 'admin', role: 'admin' };

      mockJwtService.verifyAsync.mockResolvedValue(payload);
      mockUsersStore.findByUsername.mockResolvedValue(adminUser);
      mockJwtService.signAsync.mockResolvedValue('new-token');

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw UnauthorizedException when user was deleted', async () => {
      const payload = { sub: 'ghost', username: 'ghost', role: 'user' };

      mockJwtService.verifyAsync.mockResolvedValue(payload);
      mockUsersStore.findByUsername.mockResolvedValue(null);

      await expect(service.refreshTokens('valid-token')).rejects.toThrow(
        'User not found',
      );
    });

    it('should throw UnauthorizedException with invalid token', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(service.refreshTokens('bad-token')).rejects.toThrow(
        'Invalid refresh token',
      );
    });
  });

  describe('validateUser', () => {
    it('should return the user when found', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(adminUser);

      const result = await service.validateUser('admin');

      expect(result.username).toBe('admin');
    });

    it('should throw UnauthorizedException when not found', async () => {
      mockUsersStore.findByUsername.mockResolvedValue(null);

      await expect(service.validateUser('ghost')).rejects.toThrow('User not found');
    });
  });

  describe('logout', () => {
    it('should return success', async () => {
      const result = await service.logout('admin');

      expect(result.success).toBe(true);
    });
  });
});