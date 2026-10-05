import { Test, TestingModule } from '@nestjs/testing';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UsersStoreService } from './users-store.service';

describe('UsersStoreService', () => {
  let service: UsersStoreService;

  const tempFilePath = path.join(__dirname, '__tmp_users_test.json');
  const originalFilePath = path.join(__dirname, 'users.json');

  const writeTempFile = (content: unknown) =>
    fs.writeFile(tempFilePath, JSON.stringify(content, null, 2), 'utf-8');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersStoreService],
    }).compile();

    service = module.get<UsersStoreService>(UsersStoreService);
    (service as any).filePath = tempFilePath;
    (service as any).cache = null;
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // ignore
    }
  });

  describe('shipped users.json', () => {
    it('should contain admin and navid with the expected passwords', async () => {
      const raw = JSON.parse(await fs.readFile(originalFilePath, 'utf-8'));

      const admin = raw.users.find((u: any) => u.username === 'admin');
      const navid = raw.users.find((u: any) => u.username === 'navid');

      expect(admin).toBeDefined();
      expect(admin.password).toBe('admin');
      expect(admin.role).toBe('admin');

      expect(navid).toBeDefined();
      expect(navid.password).toBe('navid');
      expect(navid.role).toBe('user');
    });
  });

  describe('getUsers', () => {
    it('should return the users from the file', async () => {
      await writeTempFile({
        users: [
          { username: 'admin', password: 'admin', role: 'admin' },
          { username: 'navid', password: 'navid', role: 'user' },
        ],
      });

      const users = await service.getUsers();

      expect(users).toHaveLength(2);
      expect(users[0].username).toBe('admin');
      expect(users[1].username).toBe('navid');
    });
  });

  describe('findByUsername', () => {
    it('should find a user case-insensitively', async () => {
      await writeTempFile({
        users: [{ username: 'admin', password: 'admin', role: 'admin' }],
      });

      const found = await service.findByUsername('ADMIN');

      expect(found?.username).toBe('admin');
    });

    it('should return null for unknown user', async () => {
      await writeTempFile({
        users: [{ username: 'admin', password: 'admin', role: 'admin' }],
      });

      const found = await service.findByUsername('nobody');

      expect(found).toBeNull();
    });
  });

  describe('addUser', () => {
    it('should add a new user and persist to the file', async () => {
      await writeTempFile({
        users: [{ username: 'admin', password: 'admin', role: 'admin' }],
      });

      const created = await service.addUser({
        username: 'navid',
        password: 'navid',
        role: 'user',
      });

      expect(created.username).toBe('navid');

      const persisted = JSON.parse(await fs.readFile(tempFilePath, 'utf-8'));
      expect(persisted.users).toHaveLength(2);
      expect(persisted.users[1].username).toBe('navid');
    });

    it('should reject a duplicate username', async () => {
      await writeTempFile({
        users: [{ username: 'admin', password: 'admin', role: 'admin' }],
      });

      await expect(
        service.addUser({ username: 'admin', password: 'x', role: 'user' }),
      ).rejects.toThrow('Username already exists');
    });
  });

  describe('updateUser', () => {
    it('should update the password', async () => {
      await writeTempFile({
        users: [{ username: 'navid', password: 'navid', role: 'user' }],
      });

      const updated = await service.updateUser('navid', { password: 'newpass' });

      expect(updated?.password).toBe('newpass');

      const persisted = JSON.parse(await fs.readFile(tempFilePath, 'utf-8'));
      expect(persisted.users[0].password).toBe('newpass');
    });

    it('should return null when the user does not exist', async () => {
      await writeTempFile({ users: [] });

      const updated = await service.updateUser('ghost', { password: 'x' });

      expect(updated).toBeNull();
    });
  });

  describe('deleteUser', () => {
    it('should delete the user from the file', async () => {
      await writeTempFile({
        users: [
          { username: 'admin', password: 'admin', role: 'admin' },
          { username: 'navid', password: 'navid', role: 'user' },
        ],
      });

      const removed = await service.deleteUser('navid');

      expect(removed).toBe(true);

      const persisted = JSON.parse(await fs.readFile(tempFilePath, 'utf-8'));
      expect(persisted.users).toHaveLength(1);
    });

    it('should return false when the user does not exist', async () => {
      await writeTempFile({ users: [] });

      const removed = await service.deleteUser('ghost');

      expect(removed).toBe(false);
    });
  });
});