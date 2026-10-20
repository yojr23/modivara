import { BellRing, CheckCheck, HandHelping, type LucideIcon } from 'lucide-react';
import { cn } from './cn';

export type CallStatus = 'pending' | 'attending' | 'done';

// Color + ícono + texto: el estado nunca depende solo del color.
const STATUS: Record<CallStatus, { label: string; Icon: LucideIcon; cls: string }> = {
  pending: { label: 'Pendiente', Icon: BellRing, cls: 'bg-pending text-pending-fg' },
  attending: { label: 'En atención', Icon: HandHelping, cls: 'bg-attending text-attending-fg' },
  done: { label: 'Atendida', Icon: CheckCheck, cls: 'bg-done text-done-fg' },
};

export function StatusBadge({ status, className }: { status: CallStatus; className?: string }) {
  const { label, Icon, cls } = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', cls, className)}>
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}
