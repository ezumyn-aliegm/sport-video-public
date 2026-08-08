import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef(function TabsList({ className, ...props }, ref) {
  return <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center justify-start gap-2', className)} {...props} />;
});

export const TabsTrigger = forwardRef(function TabsTrigger({ className, ...props }, ref) {
  return <TabsPrimitive.Trigger ref={ref} className={cn('inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-md)] px-3.5 py-2 text-sm font-extrabold text-[var(--muted)] outline-none transition-colors hover:bg-[var(--cream-deep)] hover:text-[var(--grass)] focus-visible:ring-2 focus-visible:ring-[var(--sky)] data-[state=active]:bg-[var(--grass)] data-[state=active]:text-white', className)} {...props} />;
});

export const TabsContent = forwardRef(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('mt-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sky)]', className)} {...props} />;
});
