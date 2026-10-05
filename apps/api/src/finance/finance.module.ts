import { Module } from '@nestjs/common';

import { AnimalDetailService } from '../animals/animal-detail.service.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import { VaccineStatusService } from '../animals/vaccine-status.service.js';
import { ExpensesService } from './expenses.service.js';
import { FinanceExportService } from './finance-export.service.js';
import { FinanceReportsService } from './finance-reports.service.js';
import {
  AnimalFinanceController,
  ExpensesController,
  FinanceSummaryController,
  SalesController,
  ValuationsController,
} from './finance.controller.js';
import { SalesValuationsService } from './sales-valuations.service.js';

/** Finanzas (M7: ECO-01 a ECO-06), solo ADMIN (RN-20). */
@Module({
  controllers: [
    ExpensesController,
    SalesController,
    ValuationsController,
    AnimalFinanceController,
    FinanceSummaryController,
  ],
  providers: [
    FarmContextService,
    VaccineStatusService,
    AnimalDetailService,
    ExpensesService,
    SalesValuationsService,
    FinanceReportsService,
    FinanceExportService,
  ],
})
export class FinanceModule {}
