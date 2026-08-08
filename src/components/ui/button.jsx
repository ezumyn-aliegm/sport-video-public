import { Slot } from '@radix-ui/react-slot';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button-variants';

export const Button = forwardRef(function Button(
  { className, variant, size, asChild = false, type = 'button', ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
