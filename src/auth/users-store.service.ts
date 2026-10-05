import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface StoredUser {
  username: string;
  password: string;
  role: string;
}

interface UsersFile {
  users: StoredUser[];
}

@Injectable()
export class UsersStoreService {
  private readonly logger = new Logger(UsersStoreService.name);
  private readonly filePath = path.join(__dirname, 'users.json');
  private cache: UsersFile | null = null;

  async getUsers(): Promise<StoredUser[]> {
    const data = await this.load();
    return data.users;
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const users = await this.getUsers();
    const normalized = username.trim().toLowerCase();
    return users.find((u) => u.username.toLowerCase() === normalized) ?? null;
  }

  async addUser(user: StoredUser): Promise<StoredUser> {
    const data = await this.load();
    const normalized = user.username.trim().toLowerCase();

    const exists = data.users.some((u) => u.username.toLowerCase() === normalized);
    if (exists) {
      throw new Error('Username already exists');
    }

    const created: StoredUser = {
      username: user.username.trim(),
      password: user.password,
      role: user.role,
    };

    data.users.push(created);
    await this.save(data);
    return created;
  }

  async updateUser(
    username: string,
    updates: Partial<Pick<StoredUser, 'password' | 'role'>>,
  ): Promise<StoredUser | null> {
    const data = await this.load();
    const normalized = username.trim().toLowerCase();
    const user = data.users.find((u) => u.username.toLowerCase() === normalized);

    if (!user) return null;

    if (updates.password !== undefined) user.password = updates.password;
    if (updates.role !== undefined) user.role = updates.role;

    await this.save(data);
    return user;
  }

  async deleteUser(username: string): Promise<boolean> {
    const data = await this.load();
    const normalized = username.trim().toLowerCase();
    const index = data.users.findIndex((u) => u.username.toLowerCase() === normalized);

    if (index === -1) return false;

    data.users.splice(index, 1);
    await this.save(data);
    return true;
  }

  private async load(): Promise<UsersFile> {
    if (this.cache) return this.cache;

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as UsersFile;
      this.cache = { users: parsed.users ?? [] };
    } catch (error) {
      this.logger.error(`Failed to read users file: ${this.filePath}`, error);
      throw new Error('Users file is not available');
    }

    return this.cache;
  }

  private async save(data: UsersFile): Promise<void> {
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    this.cache = data;
    this.logger.log(`Users file updated (${data.users.length} users)`);
  }
}