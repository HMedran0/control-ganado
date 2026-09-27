import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

/**
 * Autenticación (AUT-01 a AUT-04).
 *
 * Es global porque `AccessGuard` —registrado como guard global en `AppModule`— necesita
 * `TokenService`, y porque el módulo de usuarios usa `AuthService` para revocar sesiones.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, LoginAttemptsService],
  exports: [AuthService, PasswordService, TokenService, LoginAttemptsService],
})
export class AuthModule {}
