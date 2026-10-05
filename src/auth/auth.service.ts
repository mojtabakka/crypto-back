import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersStoreService, StoredUser } from './users-store.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersStore: UsersStoreService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersStore.findByUsername(dto.username);

    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-key',
      });

      const user = await this.usersStore.findByUsername(payload.username);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(username: string) {
    this.logger.log(`User ${username} logged out`);
    return { success: true };
  }

  async getProfile(username: string) {
    const user = await this.usersStore.findByUsername(username);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.sanitizeUser(user);
  }

  async validateUser(username: string) {
    const user = await this.usersStore.findByUsername(username);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  private async generateTokens(user: StoredUser) {
    const payload = { sub: user.username, username: user.username, role: user.role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET || 'jwt-secret-key',
        expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-key',
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
      }),
    ]);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    };
  }

  private sanitizeUser(user: StoredUser) {
    return { username: user.username, role: user.role };
  }
}