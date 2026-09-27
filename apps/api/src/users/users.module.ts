import { Module } from '@nestjs/common';

import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Gestión de usuarios de la finca (AUT-03, AUT-04 CA2). */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
