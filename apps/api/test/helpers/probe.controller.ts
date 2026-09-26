import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DomainError, ROLE, farmSettingsSchema, uuidv7, type FarmSettings } from '@hato/shared';

import { Audit } from '../../src/common/audit/audit.decorator.js';
import { CurrentScope } from '../../src/common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../../src/common/farm-scope/farm-scope.types.js';
import { Roles } from '../../src/common/roles/roles.decorator.js';
import { ZodValidationPipe } from '../../src/common/validation/zod-validation.pipe.js';
import { PrismaService } from '../../src/infra/prisma.service.js';
import { farmFilter } from '../../src/common/scoped-prisma.js';

/**
 * Controlador que existe **solo en las pruebas**, para ejercitar la infraestructura
 * transversal sin inventar módulos de negocio (esos llegan en M1).
 *
 * Cada endpoint prueba una pieza: el filtro de errores, el ámbito de finca, los roles, la
 * validación con zod y la auditoría.
 */
@Controller('probe')
export class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Lanza un `DomainError` del catálogo, con interpolación de parámetros. */
  @Get('domain-error')
  domainError(): never {
    throw new DomainError('ANIMAL_CODE_TAKEN', { params: { code: '26-045' } });
  }

  /** Lanza un `DomainError` de validación con errores por campo. */
  @Get('validation-error')
  validationError(): never {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: { birthDate: ['La fecha no puede ser posterior a hoy.'] },
    });
  }

  /** Lanza un error cualquiera, no controlado. */
  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error('detalle interno que no debe salir al cliente');
  }

  /** Devuelve el ámbito resuelto por el guard. */
  @Get('scope')
  scope(@CurrentScope() scope: FarmScope): FarmScope {
    return scope;
  }

  /** Cuenta los animales de la finca del ámbito, filtrando con `farmFilter`. */
  @Get('animals/count')
  async countAnimals(@CurrentScope() scope: FarmScope): Promise<{ count: number }> {
    const count = await this.prisma.animal.count({ where: farmFilter(scope) });
    return { count };
  }

  /** Lista los códigos de los animales de la finca del ámbito. */
  @Get('animals/codes')
  async animalCodes(@CurrentScope() scope: FarmScope): Promise<{ codes: string[] }> {
    const rows = await this.prisma.animal.findMany({
      where: farmFilter(scope),
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    return { codes: rows.map((row) => row.code) };
  }

  /** Solo ADMIN: prueba el `RolesGuard`. */
  @Get('admin-only')
  @Roles(ROLE.ADMIN)
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  /** Solo VET: prueba que un ADMIN también recibe 403 si no está en la lista. */
  @Get('vet-only')
  @Roles(ROLE.VET)
  vetOnly(): { ok: true } {
    return { ok: true };
  }

  /** Valida la query con un esquema zod de shared. */
  @Get('settings')
  settings(
    @Query('raw', new ZodValidationPipe(farmSettingsSchema)) raw: FarmSettings,
  ): FarmSettings {
    return raw;
  }

  /** Escritura auditable: crea una raza y la devuelve, para que el interceptor la registre. */
  @Post('breeds')
  @Audit({ entity: 'Breed', action: 'CREATE' })
  async createBreed(
    @CurrentScope() scope: FarmScope,
    @Body() body: { name: string },
  ): Promise<{ id: string; name: string }> {
    const breed = await this.prisma.breed.create({
      data: { id: uuidv7(), farmId: scope.farmId, name: body.name },
    });
    return { id: breed.id, name: breed.name };
  }

  /** Escritura auditable que falla: no debe registrar nada. */
  @Post('breeds/failing')
  @Audit({ entity: 'Breed', action: 'CREATE' })
  failingWrite(): never {
    throw new DomainError('ANIMAL_CODE_TAKEN', { params: { code: 'X' } });
  }
}
