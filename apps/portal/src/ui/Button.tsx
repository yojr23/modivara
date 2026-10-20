import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '@/ui/cn';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
        secondary: 'border border-line-strong bg-surface text-fg hover:bg-sunken',
        ghost: 'text-fg hover:bg-sunken',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-base',
        lg: 'h-14 px-6 text-lg', // objetivo táctil amplio para el tablero de barra
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof button> & { asChild?: boolean };

export function Button({ variant, size, className, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  // Con asChild el hijo decide su propio type (p. ej. <a>).
  return <Comp type={asChild ? type : (type ?? 'button')} className={cn(button({ variant, size }), className)} {...props} />;
}
