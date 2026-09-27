import { expect, test } from '@playwright/test';

/** El paquete de producción (`vite preview`) no incluye la muestra de componentes. */
test('/dev/ui no existe en el build de producción', async ({ page }) => {
  await page.goto('/dev/ui');

  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  await expect(page.getByText('Muestra de componentes')).toHaveCount(0);
});
