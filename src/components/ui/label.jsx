import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Label = forwardRef(function Label({ className, ...props }, ref) {
  return <LabelPrimitive.Root ref={ref} className={cn('text-sm font-extrabold leading-none text-[var(--grass)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)} {...props} />;
});
