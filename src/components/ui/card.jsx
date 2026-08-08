import { Slot } from '@radix-ui/react-slot';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Card = forwardRef(function Card({ asChild = false, className, ...props }, ref) {
  const Comp = asChild ? Slot : 'div';
  return <Comp ref={ref} className={cn('rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow)]', className)} {...props} />;
});

export const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
});

export const CardTitle = forwardRef(function CardTitle({ className, ...props }, ref) {
  return <h3 ref={ref} className={cn('font-extrabold tracking-tight text-[var(--grass)]', className)} {...props} />;
});

export const CardDescription = forwardRef(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-[var(--muted)]', className)} {...props} />;
});

export const CardContent = forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
});

export const CardFooter = forwardRef(function CardFooter({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />;
});
