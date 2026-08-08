import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-[rgba(26,26,26,.46)]', className)} {...props} />;
});

export const DialogContent = forwardRef(function DialogContent({ className, overlayClassName, children, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content ref={ref} className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] outline-none', className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export const DialogTitle = forwardRef(function DialogTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('text-[var(--grass)]', className)} {...props} />;
});

export const DialogDescription = forwardRef(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-[var(--muted)]', className)} {...props} />;
});
