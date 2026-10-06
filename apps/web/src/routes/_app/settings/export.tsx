import { createFileRoute } from '@tanstack/react-router';

import { ExportPage } from '../../../features/export/ExportPage';

export const Route = createFileRoute('/_app/settings/export')({
  component: ExportPage,
});
