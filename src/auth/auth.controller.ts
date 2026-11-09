import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
  Req,
  HttpCode,
  Header,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  UpdateUserDto,
  SessionTimeoutDto,
} from './dto/auth.dto';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserEntity } from './users.entity';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: UserEntity;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest) {
    return this.authService.login(dto, req.ip);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest) {
    const refreshToken = (req as any).body?.refresh_token;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    return { success: true };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: UserEntity) {
    return this.authService.getProfile(user.id);
  }

  @Patch('change-password')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: UserEntity,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.id, dto);
    return { success: true };
  }

  // ==========================================
  // Admin routes
  // ==========================================
  @Get('admin/users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  async listUsers() {
    return this.authService.listUsers();
  }

  @Patch('admin/users/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.authService.updateUser(parseInt(id, 10), dto, user.id);
  }

  @Patch('admin/users/:id/session-timeout')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  async setSessionTimeout(
    @Param('id') id: string,
    @Body() dto: SessionTimeoutDto,
  ) {
    return this.authService.setSessionTimeout(parseInt(id, 10), dto);
  }

  @Delete('admin/users/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    await this.authService.deleteUser(parseInt(id, 10), user.id);
  }
}
