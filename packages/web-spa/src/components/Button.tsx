import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  busy?: boolean;
};

export function Button({ variant = 'secondary', busy = false, className, disabled, type, children, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}
