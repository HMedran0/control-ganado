import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ROLE,
  createExpenseSchema,
  createValuationSchema,
  financeSummaryQuerySchema,
  listExpensesQuerySchema,
  listSalesQuerySchema,
  updateExpenseSchema,
  updateSaleSchema,
  voidEventSchema,
  type AnimalFinance,
  type CreateExpenseInput,
  type CreateValuationInput,
  type ExpenseDetail,
  type ExpenseList,
  type ExpensePreview,
  type FinanceSummary,
  type FinanceSummaryQuery,
  type ListExpensesQuery,
  type ListSalesQuery,
  type SaleList,
  type SaleView,
  type UpdateExpenseInput,
  type UpdateSaleInput,
  type ValuationView,
  type VoidEventInput,
} from '@hato/shared';
import type { FastifyReply } from 'fastify';

import { XLSX_CONTENT_TYPE } from '../animals/animal-export.service.js';
import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody, ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ExpensesService } from './expenses.service.js';
import { FinanceExportService } from './finance-export.service.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { SalesValuationsService } from './sales-valuations.service.js';

/**
 * Finanzas (05-api.md «Finanzas», ECO-01 a ECO-06). **Todo solo ADMIN** (RN-20, SRS §2.3): el
 * rol se comprueba en el servidor para cada ruta, a nivel de clase.
 */
@Controller('expenses')
@Roles(ROLE.ADMIN)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listExpensesQuerySchema)) query: ListExpensesQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<ExpenseList> {
    return this.expenses.list(scope, query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<ExpenseDetail> {
    return this.expenses.detail(scope, id);
  }

  /** Con `dryRun: true` responde 200 con el reparto, sin guardar (ECO-02). */
  @Post()
  async create(
    @ZodBody(createExpenseSchema) body: CreateExpenseInput,
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExpenseDetail | ExpensePreview> {
    const result = await this.expenses.create(scope, body);
    if (body.dryRun === true) void reply.status(200);
    return result;
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateExpenseSchema) body: UpdateExpenseInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ExpenseDetail> {
    return this.expenses.update(scope, id, body);
  }

  @Post(':id/void')
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidEventSchema) body: VoidEventInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ExpenseDetail> {
    return this.expenses.void(scope, id, body);
  }
}

/** Ventas (ECO-04): nacen con la salida; aquí se listan y se corrigen. Solo ADMIN. */
@Controller('sales')
@Roles(ROLE.ADMIN)
export class SalesController {
  constructor(private readonly sales: SalesValuationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listSalesQuerySchema)) query: ListSalesQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<SaleList> {
    return this.sales.listSales(scope, query);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateSaleSchema) body: UpdateSaleInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<SaleView> {
    return this.sales.updateSale(scope, id, body);
  }
}

/** Avalúos (ECO-03). Solo ADMIN. */
@Controller('valuations')
@Roles(ROLE.ADMIN)
export class ValuationsController {
  constructor(private readonly valuations: SalesValuationsService) {}

  @Post()
  create(
    @ZodBody(createValuationSchema) body: CreateValuationInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ValuationView> {
    return this.valuations.createValuation(scope, body);
  }

  @Post(':id/void')
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidEventSchema) body: VoidEventInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ValuationView> {
    return this.valuations.voidValuation(scope, id, body);
  }
}

/** Pestaña Costos de la ficha (ECO-05). Solo ADMIN. */
@Controller('animals')
@Roles(ROLE.ADMIN)
export class AnimalFinanceController {
  constructor(private readonly reports: FinanceReportsService) {}

  @Get(':id/finance')
  finance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalFinance> {
    return this.reports.animalFinance(scope, id);
  }
}

/** Reporte económico (ECO-06) y su exportación a Excel. Solo ADMIN. */
@Controller('finance')
@Roles(ROLE.ADMIN)
export class FinanceSummaryController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly exporter: FinanceExportService,
  ) {}

  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(financeSummaryQuerySchema)) query: FinanceSummaryQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<FinanceSummary> {
    return this.reports.summary(scope, query);
  }

  @Get('summary/export.xlsx')
  async export(
    @Query(new ZodValidationPipe(financeSummaryQuerySchema)) query: FinanceSummaryQuery,
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.exporter.export(scope, query);
    reply.header('content-type', XLSX_CONTENT_TYPE);
    reply.header('content-disposition', `attachment; filename="${file.fileName}"`);
    reply.header('cache-control', 'no-store');
    return file.data;
  }
}
