import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersStoreService } from './users-store.service';
import { AdminController } from './admin.controller';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('Auth flow with the real users.json (integration)', () => {
  let authService: AuthService;
  let usersStore: UsersStoreService;
  let adminController: AdminController;

  const realUsersPath = path.join(__dirname, 'users.json');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AuthService,
        UsersStoreService,
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('signed-token'),
            verifyAsync: jest.fn().mockResolvedValue({ username: 'admin' }),
          },
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    usersStore = module.get(UsersStoreService);
    adminController = module.get(AdminController);
    (usersStore as any).cache = null;
  });

  afterEach(async () => {
    (usersStore as any).cache = null;
  });

  it('logs in admin with admin/admin and returns an admin role', async () => {
    const result = await authService.login({ username: 'admin', password: 'admin' });

    expect(result.user).toEqual({ username: 'admin', role: 'admin' });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  it('logs in navid with navid/navid and returns a user role', async () => {
    const result = await authService.login({ username: 'navid', password: 'navid' });

    expect(result.user).toEqual({ username: 'navid', role: 'user' });
  });

  it('rejects admin/admin@wrong', async () => {
    await expect(
      authService.login({ username: 'admin', password: 'admin@wrong' }),
    ).rejects.toThrow('Invalid username or password');
  });

  it('is case-insensitive on the username', async () => {
    const result = await authService.login({ username: 'ADMIN', password: 'admin' });

    expect(result.user.username).toBe('admin');
  });

  it('admin controller lists both users and never leaks passwords', async () => {
    const users = await adminController.getAllUsers({ username: 'admin', role: 'admin' });

    expect(users.map((u: any) => u.username)).toEqual(
      expect.arrayContaining(['admin', 'navid']),
    );
    expect(JSON.stringify(users)).not.toContain('password');
  });

  it('non-admin is forbidden from listing users', async () => {
    await expect(
      adminController.getAllUsers({ username: 'navid', role: 'user' }),
    ).rejects.toThrow('Access denied');
  });

  it('non-admin cannot create a user', async () => {
    await expect(
      adminController.createUser({ username: 'navid', role: 'user' }, {
        username: 'sneaky',
        password: 'sneaky',
      }),
    ).rejects.toThrow('Access denied');
  });

  it('admin can add a user and it is persisted to users.json', async () => {
    const backup = await fs.readFile(realUsersPath, 'utf-8');

    try {
      await adminController.createUser({ username: 'admin', role: 'admin' }, {
        username: 'tempuser',
        password: 'temp123',
        role: 'user',
      });

      const persisted = JSON.parse(await fs.readFile(realUsersPath, 'utf-8'));
      expect(persisted.users.find((u: any) => u.username === 'tempuser')).toBeDefined();

      const users = await adminController.getAllUsers({ username: 'admin', role: 'admin' });
      expect(users.find((u: any) => u.username === 'tempuser')).toBeDefined();
    } finally {
      await fs.writeFile(realUsersPath, backup, 'utf-8');
      (usersStore as any).cache = null;
    }
  });

  it('rejects a duplicate username', async () => {
    const backup = await fs.readFile(realUsersPath, 'utf-8');

    try {
      await expect(
        adminController.createUser({ username: 'admin', role: 'admin' }, {
          username: 'navid',
          password: 'x',
        }),
      ).rejects.toThrow('Username already exists');
    } finally {
      await fs.writeFile(realUsersPath, backup, 'utf-8');
      (usersStore as any).cache = null;
    }
  });

  it('admin can reset navid password and login works with the new one', async () => {
    const backup = await fs.readFile(realUsersPath, 'utf-8');

    try {
      await adminController.resetPassword(
        { username: 'admin', role: 'admin' },
        'navid',
        { newPassword: 'newpass123' },
      );
      (usersStore as any).cache = null;

      await expect(
        authService.login({ username: 'navid', password: 'newpass123' }),
      ).resolves.toBeDefined();

      await expect(
        authService.login({ username: 'navid', password: 'navid' }),
      ).rejects.toThrow('Invalid username or password');
    } finally {
      await fs.writeFile(realUsersPath, backup, 'utf-8');
      (usersStore as any).cache = null;
    }
  });

  it('admin cannot delete themselves', async () => {
    await expect(
      adminController.deleteUser({ username: 'admin', role: 'admin' }, 'admin'),
    ).rejects.toThrow('Cannot delete yourself');
  });

  it('admin can delete another user and it disappears from the file', async () => {
    const backup = await fs.readFile(realUsersPath, 'utf-8');

    try {
      await adminController.deleteUser({ username: 'admin', role: 'admin' }, 'navid');
      (usersStore as any).cache = null;

      const persisted = JSON.parse(await fs.readFile(realUsersPath, 'utf-8'));
      expect(persisted.users.find((u: any) => u.username === 'navid')).toBeUndefined();

      await expect(
        authService.login({ username: 'navid', password: 'navid' }),
      ).rejects.toThrow('Invalid username or password');
    } finally {
      await fs.writeFile(realUsersPath, backup, 'utf-8');
      (usersStore as any).cache = null;
    }
  });
});