import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Select = forwardRef(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn('flex h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-base text-[var(--ink)] shadow-sm outline-none transition-colors focus-visible:border-[var(--sky)] focus-visible:ring-2 focus-visible:ring-[rgba(74,144,217,.24)] disabled:cursor-not-allowed disabled:opacity-55', className)} {...props} />;
});
