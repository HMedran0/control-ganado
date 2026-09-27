import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { TextField, type TextFieldProps } from './TextField';

/**
 * Campo de contraseña con opción de mostrarla (06 §5.7).
 *
 * En la manga, con guantes y a pleno sol, escribir a ciegas produce errores; ver lo escrito
 * ahorra intentos fallidos y bloqueos.
 */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          aria-pressed={visible}
          aria-label="Mostrar contraseña"
          onClick={() => {
            setVisible((current) => !current);
          }}
          className="inline-flex size-12 items-center justify-center rounded-control text-texto-2 hover:text-monte"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-6" />
          ) : (
            <Eye aria-hidden="true" className="size-6" />
          )}
        </button>
      }
    />
  );
}
