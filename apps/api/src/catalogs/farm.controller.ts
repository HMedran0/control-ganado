import { Controller, Get, Patch } from '@nestjs/common';
import { ROLE, updateFarmSchema, type FarmView, type UpdateFarmInput } from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody } from '../common/validation/zod-validation.pipe.js';
import { FarmService } from './farm.service.js';

/** `GET /farm` (todos) y `PATCH /farm` (ADMIN). 05-api.md «Usuarios y finca». */
@Controller('farm')
export class FarmController {
  constructor(private readonly farms: FarmService) {}

  @Get()
  get(@CurrentScope() scope: FarmScope): Promise<FarmView> {
    return this.farms.get(scope);
  }

  @Roles(ROLE.ADMIN)
  @Patch()
  update(
    @ZodBody(updateFarmSchema) body: UpdateFarmInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<FarmView> {
    return this.farms.update(scope, body);
  }
}
