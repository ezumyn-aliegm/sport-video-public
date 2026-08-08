import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2 text-sm font-extrabold leading-tight transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sky)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-wait disabled:opacity-55',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--orange)] text-white shadow-[0_5px_14px_rgba(194,65,12,.22)] hover:-translate-y-px hover:bg-[var(--orange-dark)] hover:shadow-[0_8px_18px_rgba(154,52,18,.28)]',
        secondary: 'border border-[var(--line)] bg-[var(--paper)] text-[var(--grass)] hover:border-[var(--sky)] hover:bg-[#f9fcff]',
        ghost: 'bg-transparent text-[var(--grass)] hover:bg-[var(--cream-deep)]',
        icon: 'h-11 w-11 rounded-full bg-[var(--cream-deep)] p-0 text-[var(--grass)] text-2xl leading-none hover:bg-[var(--orange-soft)]',
        unstyled: 'rounded-none bg-transparent p-0 text-inherit shadow-none hover:translate-y-0 hover:bg-transparent hover:shadow-none',
      },
      size: {
        default: '',
        sm: 'min-h-9 px-3 text-xs',
        lg: 'min-h-12 px-5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);
