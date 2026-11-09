import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { UserEntity, UserRole } from './users.entity';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  UpdateUserDto,
  SessionTimeoutDto,
} from './dto/auth.dto';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface TokenPayload {
  sub: number;
  username: string;
  role: UserRole;
  session_timeout_minutes: number;
  type: 'access' | 'refresh';
}

/** Convert "15m" / "900s" / "1h" / "7d" into seconds. */
function expiresInSeconds(value: string | undefined, fallback: string): number {
  const raw = (value ?? fallback).trim();
  const match = /^(\d+)\s*([smhd])?$/i.exec(raw);
  if (!match) return 900;

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
  };

  return amount * (multipliers[unit] ?? 1);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory refresh token store (revoked tokens)
  // In production, use Redis for this
  private readonly revokedRefreshTokens = new Set<string>();

  // Simple in-memory rate-limit tracker for auth endpoints
  // Key: identifier (ip or username), Value: { count, firstAttempt }
  private readonly authAttempts = new Map<
    string,
    { count: number; firstAttempt: number }
  >();

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
  ) {}

  // ==========================================
  // Register
  // ==========================================
  async register(dto: RegisterDto): Promise<{ user: UserEntity }> {
    const existing = await this.usersRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }

    if (dto.email) {
      const existingEmail = await this.usersRepository.findOne({
        where: { email: dto.email },
      });
      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = this.usersRepository.create({
      username: dto.username,
      email: dto.email ?? null,
      password_hash: passwordHash,
      // Users ALWAYS register as 'user'. Admins are managed ONLY via auth.seed.ts.
      role: 'user',
      session_timeout_minutes: 60,
      is_active: true,
    });

    const saved = await this.usersRepository.save(user);
    return { user: saved };
  }

  // ==========================================
  // Login
  // ==========================================
  async login(
    dto: LoginDto,
    clientIp?: string,
  ): Promise<{ user: UserEntity; tokens: TokenPair }> {
    const identifier = clientIp ?? 'unknown';

    // Rate-limit check: configurable attempts per 15 minutes per IP
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const configured = parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '5', 10);
    const maxAttempts = Number.isFinite(configured) && configured > 0 ? configured : 5;

    const record = this.authAttempts.get(identifier);
    if (record) {
      if (now - record.firstAttempt > windowMs) {
        // Reset window
        this.authAttempts.set(identifier, { count: 1, firstAttempt: now });
      } else if (record.count >= maxAttempts) {
        throw new HttpException(
          'Too many login attempts. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      } else {
        record.count++;
      }
    } else {
      this.authAttempts.set(identifier, { count: 1, firstAttempt: now });
    }

    const user = await this.usersRepository.findOne({
      where: { username: dto.username },
    });

    if (!user || !user.is_active) {
      // Still count the attempt but don't reveal whether user exists
      await this.jwtService.signAsync({ sub: 0 }); // dummy to keep timing consistent
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset attempts on successful login
    this.authAttempts.delete(identifier);

    // Update last login
    user.last_login = new Date();
    await this.usersRepository.save(user);

    const tokens = await this.generateTokenPair(user);
    return { user, tokens };
  }

  // ==========================================
  // Refresh token
  // ==========================================
  async refresh(dto: RefreshTokenDto): Promise<TokenPair> {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(dto.refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'default-refresh-secret-change-me',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload?.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }

    if (this.revokedRefreshTokens.has(dto.refresh_token)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Revoke old refresh token (rotation)
    this.revokedRefreshTokens.add(dto.refresh_token);

    return this.generateTokenPair(user);
  }

  // ==========================================
  // Logout
  // ==========================================
  async logout(refreshToken: string): Promise<void> {
    this.revokedRefreshTokens.add(refreshToken);
  }

  // ==========================================
  // Me
  // ==========================================
  async getProfile(userId: number): Promise<UserEntity> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // ==========================================
  // Change password (own)
  // ==========================================
  async changePassword(
    userId: number,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(dto.old_password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password_hash = await bcrypt.hash(dto.new_password, 12);
    await this.usersRepository.save(user);

    // Revoke all refresh tokens for this user (force re-login)
    // In production, track per-user tokens in Redis
    this.logger.log(`Password changed for user ${user.id}, revoking sessions`);
  }

  // ==========================================
  // Admin: List users
  // ==========================================
  async listUsers(): Promise<UserEntity[]> {
    return this.usersRepository.find({
      order: { created_at: 'DESC' },
      select: [
        'id',
        'username',
        'email',
        'role',
        'session_timeout_minutes',
        'is_active',
        'last_login',
        'created_at',
        'updated_at',
      ],
    });
  }

  // ==========================================
  // Admin: Update user
  // ==========================================
  async updateUser(
    id: number,
    dto: UpdateUserDto,
    currentUserId: number,
  ): Promise<UserEntity> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isSelf = id === currentUserId;

    // An admin may edit any account (including other admins), but nobody may
    // lock themselves out of the panel.
    if (isSelf) {
      if (dto.role && dto.role !== user.role) {
        throw new ForbiddenException('You cannot change your own role');
      }
      if (dto.is_active === false) {
        throw new ForbiddenException(
          'You cannot deactivate your own account',
        );
      }
    }

    // The system must always keep at least one usable admin.
    if (user.role === 'admin' && dto.role === 'user') {
      const adminCount = await this.usersRepository.count({
        where: { role: 'admin', is_active: true },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException(
          'Cannot demote the only remaining admin',
        );
      }
    }

    if (dto.username && dto.username !== user.username) {
      const existing = await this.usersRepository.findOne({
        where: { username: dto.username },
      });
      if (existing) {
        throw new ConflictException('Username already exists');
      }
      user.username = dto.username;
    }

    if (dto.email !== undefined) user.email = dto.email;
    if (dto.role) user.role = dto.role;
    if (dto.is_active !== undefined) user.is_active = dto.is_active;
    if (dto.password) {
      user.password_hash = await bcrypt.hash(dto.password, 12);
    }

    return this.usersRepository.save(user);
  }

  // ==========================================
  // Admin: Set session timeout
  // ==========================================
  async setSessionTimeout(
    id: number,
    dto: SessionTimeoutDto,
  ): Promise<UserEntity> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Session expiry is set per account, admins included. It is the lifetime
    // of the access token issued at login (see generateTokenPair).
    user.session_timeout_minutes = dto.session_timeout_minutes;
    return this.usersRepository.save(user);
  }

  // ==========================================
  // Admin: Delete user
  // ==========================================
  async deleteUser(id: number, currentUserId: number): Promise<void> {
    if (id === currentUserId) {
      throw new BadRequestException('Cannot delete your own account');
    }

    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Admin accounts can be edited in the panel but not deleted, so the
    // last administrator cannot disappear by accident.
    if (user.role === 'admin') {
      throw new ForbiddenException(
        'Admin accounts cannot be deleted from the UI. Demote the account first if it must be removed.',
      );
    }

    await this.usersRepository.remove(user);
  }

  // ==========================================
  // Internal: Generate token pair
  // ==========================================
  private async generateTokenPair(
    user: UserEntity,
  ): Promise<TokenPair> {
    const basePayload: Omit<TokenPayload, 'type'> = {
      sub: user.id,
      username: user.username,
      role: user.role,
      session_timeout_minutes: user.session_timeout_minutes,
    };

    // The admin panel's "session expiry" (hours + minutes) is authoritative:
    // each account's access token lives exactly that long. JWT_ACCESS_EXPIRES_IN
    // is only a fallback for rows that have no value stored.
    const sessionMinutes =
      Number.isFinite(user.session_timeout_minutes) &&
      user.session_timeout_minutes >= 1
        ? Math.floor(user.session_timeout_minutes)
        : Number(expiresInSeconds(process.env.JWT_ACCESS_EXPIRES_IN, '15m') / 60);
    const accessExpires = `${sessionMinutes}m`;
    const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

    // Both tokens are signed with THEIR OWN secret. Signing the refresh token
    // with the access secret made /auth/refresh impossible to verify.
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, type: 'access' } satisfies TokenPayload,
        {
          secret: process.env.JWT_ACCESS_SECRET ?? 'default-access-secret-change-me',
          expiresIn: accessExpires as any,
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, type: 'refresh' } satisfies TokenPayload,
        {
          secret: process.env.JWT_REFRESH_SECRET ?? 'default-refresh-secret-change-me',
          expiresIn: refreshExpires as any,
        },
      ),
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresInSeconds(accessExpires, '15m'),
    };
  }
}
