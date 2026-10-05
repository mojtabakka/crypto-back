import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersStoreService } from './users-store.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly usersStore: UsersStoreService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin only)' })
  async getAllUsers(@CurrentUser() currentUser: any) {
    this.assertAdmin(currentUser);

    const users = await this.usersStore.getUsers();
    return users.map((user) => ({ username: user.username, role: user.role }));
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  async createUser(@CurrentUser() currentUser: any, @Body() body: any) {
    this.assertAdmin(currentUser);

    const { username, password, role } = body ?? {};

    if (!username || !password) {
      throw new BadRequestException('username and password are required');
    }

    try {
      const created = await this.usersStore.addUser({
        username,
        password,
        role: role === 'admin' ? 'admin' : 'user',
      });

      return { username: created.username, role: created.role };
    } catch (error) {
      if (error instanceof Error && error.message === 'Username already exists') {
        throw new BadRequestException('Username already exists');
      }
      throw error;
    }
  }

  @Post('users/:username/reset-password')
  @ApiOperation({ summary: 'Reset a user password (admin only)' })
  async resetPassword(
    @CurrentUser() currentUser: any,
    @Param('username') username: string,
    @Body() body: { newPassword?: string },
  ) {
    this.assertAdmin(currentUser);

    if (!body?.newPassword) {
      throw new BadRequestException('newPassword is required');
    }

    const updated = await this.usersStore.updateUser(username, {
      password: body.newPassword,
    });

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return { success: true, message: 'Password reset successfully' };
  }

  @Delete('users/:username')
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  async deleteUser(
    @CurrentUser() currentUser: any,
    @Param('username') username: string,
  ) {
    this.assertAdmin(currentUser);

    if (currentUser.username.toLowerCase() === username.toLowerCase()) {
      throw new BadRequestException('Cannot delete yourself');
    }

    const removed = await this.usersStore.deleteUser(username);
    if (!removed) {
      throw new NotFoundException('User not found');
    }

    return { success: true, message: 'User deleted successfully' };
  }

  private assertAdmin(currentUser: any) {
    if (currentUser?.role !== 'admin') {
      throw new ForbiddenException('Access denied. Admin only.');
    }
  }
}