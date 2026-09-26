import { SetMetadata } from '@nestjs/common';

/** Clave de metadatos que marca un endpoint accesible sin ámbito de finca. */
export const IS_PUBLIC_KEY = 'hato:isPublic';

/**
 * Marca un endpoint como público: sin autenticación ni finca.
 * Solo para `/health` y, desde M1, para `/auth/login` y `/auth/refresh`.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
