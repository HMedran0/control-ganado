/**
 * Esquemas de autenticación y usuarios (05-api.md «Autenticación» y «Usuarios y finca»).
 *
 * Son la fuente de verdad del contrato: la API valida con ellos y la web (M2) los reutiliza
 * para los formularios, así que el mensaje de error es el mismo en los dos lados.
 */

import { z } from 'zod';

import type { Role } from '../enums.js';

/** Longitud mínima de una contraseña (04-arquitectura.md §5). */
export const MIN_PASSWORD_LENGTH = 8;

/** Longitud máxima: Argon2id no la necesita, pero evita gastar CPU con entradas absurdas. */
export const MAX_PASSWORD_LENGTH = 200;

/** Nombre de usuario: minúsculas, 3 a 30 caracteres (08 §2.4). */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

/** Esquema de un nombre de usuario válido. */
export const usernameSchema = z.string().trim().toLowerCase().regex(USERNAME_PATTERN, {
  message:
    'El usuario usa de 3 a 30 caracteres: letras minúsculas, números, punto, guion y guion bajo.',
});

/** Contraseña que el usuario elige o recibe. */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  })
  .max(MAX_PASSWORD_LENGTH, { message: 'La contraseña es demasiado larga.' });

/**
 * Cuerpo de `POST /auth/login`.
 *
 * `login` acepta el nombre de usuario o el correo (AUT-01), así que no se valida contra
 * ninguno de los dos formatos: si no coincide con nada, la respuesta es la misma que con una
 * contraseña equivocada, para no revelar qué usuarios existen.
 *
 * `farmId` es opcional y solo hace falta cuando alguien pertenece a varias fincas; sin él se
 * entra a la membresía activa más antigua.
 */
export const loginSchema = z.object({
  login: z.string().trim().min(1, { message: 'Escribe tu usuario o correo.' }).max(120),
  password: z.string().min(1, { message: 'Escribe tu contraseña.' }).max(MAX_PASSWORD_LENGTH),
  farmId: z.uuid().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Cuerpo de `POST /auth/change-password` (AUT-04 CA1). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Escribe tu contraseña actual.' }),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'La contraseña nueva debe ser distinta de la actual.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Roles asignables a un usuario de la finca (SRS §2.2). */
export const assignableRoleSchema = z.enum(['ADMIN', 'OPERATOR', 'VET']);

/**
 * Cuerpo de `POST /users` (AUT-03).
 *
 * El correo es opcional porque los operarios de campo no suelen tener (08 §1.8). Una cadena
 * vacía se trata como «sin correo» para que un formulario con el campo en blanco no cree un
 * correo vacío que además chocaría con el índice único.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(2, { message: 'Escribe el nombre de la persona.' }).max(120),
  username: usernameSchema,
  email: z
    .union([z.email({ message: 'El correo no es válido.' }), z.literal('')])
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value.toLowerCase())),
  role: assignableRoleSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Cuerpo de `PATCH /users/:id`.
 *
 * Todos los campos son opcionales, pero al menos uno tiene que venir: un PATCH vacío
 * significa casi siempre que el cliente se equivocó de campo.
 */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z
      .union([z.email({ message: 'El correo no es válido.' }), z.literal('')])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === '' ? null : value.toLowerCase(),
      ),
    role: assignableRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.role !== undefined ||
      value.isActive !== undefined,
    { message: 'No hay nada que cambiar.' },
  );
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Membresía del usuario en una finca, para elegir la finca activa (ADR-007, decisión 4). */
export type MembershipView = {
  readonly farmId: string;
  readonly farmName: string;
  readonly role: Role;
};

/** Usuario de la sesión, tal como lo devuelven login, refresh y cambio de contraseña. */
export type SessionUser = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string | null;
  /** Contraseña temporal sin cambiar: solo puede cambiarla o salir (AUT-04 CA2). */
  readonly mustChangePassword: boolean;
};

/**
 * Respuesta de `POST /auth/login`, `POST /auth/refresh` y `POST /auth/change-password`.
 *
 * El token de acceso viaja en el cuerpo para que el cliente lo guarde **solo en memoria**; el
 * de refresco nunca aparece aquí, va en una cookie `HttpOnly` (ADR-007).
 */
export type SessionResponse = {
  readonly accessToken: string;
  readonly user: SessionUser;
  readonly farm: { readonly id: string; readonly name: string };
  readonly role: Role;
  readonly memberships: readonly MembershipView[];
};
