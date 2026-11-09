import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity, UserRole } from './users.entity';
import { SEED_ADMINS, SEED_USERS, SeedUser } from './auth.seed';

/**
 * Applies `auth.seed.ts` to the database on every startup.
 *
 * Policy (see the header of auth.seed.ts):
 * - Missing accounts are created with the role of the list they came from.
 * - Existing accounts are left untouched — the admin panel owns them —
 *   unless the entry sets `sync_on_restart: true`, in which case the file
 *   overwrites password/email/role/active status (recovery / enforcement).
 */
@Injectable()
export class AuthSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthSeedService.name);

  private readonly bcryptRounds = Number(
    process.env.BCRYPT_SALT_ROUNDS ?? 12,
  );

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (SEED_ADMINS.length === 0 && SEED_USERS.length === 0) {
      this.logger.warn(
        'SEED_ADMINS and SEED_USERS are empty — no accounts will be created from the seed file.',
      );
      return;
    }

    await this.seedAccounts(SEED_ADMINS, 'admin');
    await this.seedAccounts(SEED_USERS, 'user');
  }

  private async seedAccounts(
    entries: SeedUser[],
    role: UserRole,
  ): Promise<void> {
    for (const entry of entries) {
      try {
        await this.upsertAccount(entry, role);
      } catch (err) {
        this.logger.error(
          `Failed to seed ${role} "${entry.username}": ${(err as Error).message}`,
        );
      }
    }
  }

  private async upsertAccount(
    entry: SeedUser,
    role: UserRole,
  ): Promise<void> {
    const existing = await this.usersRepository.findOne({
      where: { username: entry.username },
    });

    if (!existing) {
      await this.usersRepository.save(
        this.usersRepository.create({
          username: entry.username,
          email: entry.email ?? null,
          password_hash: await bcrypt.hash(entry.password, this.bcryptRounds),
          role,
          session_timeout_minutes: 60,
          is_active: true,
        }),
      );
      this.logger.log(
        `Created ${role} "${entry.username}" from seed file`,
      );
      return;
    }

    // Create-only by default: admin-panel changes must survive restarts.
    if (entry.sync_on_restart !== true) {
      return;
    }

    let changed = false;

    const passwordMatches = await bcrypt.compare(
      entry.password,
      existing.password_hash,
    );
    if (!passwordMatches) {
      existing.password_hash = await bcrypt.hash(
        entry.password,
        this.bcryptRounds,
      );
      changed = true;
    }

    if (existing.role !== role) {
      existing.role = role;
      changed = true;
    }

    const seedEmail = entry.email ?? null;
    if (existing.email !== seedEmail) {
      existing.email = seedEmail;
      changed = true;
    }

    if (!existing.is_active) {
      existing.is_active = true;
      changed = true;
    }

    if (changed) {
      await this.usersRepository.save(existing);
      this.logger.log(
        `Synced "${entry.username}" from seed file (sync_on_restart)`,
      );
    }
  }
}
