import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ActionCapsuleTone = 'blue' | 'green' | 'red' | 'amber' | 'slate';
type ActionCapsuleSize = 'sm' | 'md' | 'lg';
type ActionCapsuleVariant = 'soft' | 'solid' | 'neutral';

interface ActionCapsuleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  tone?: ActionCapsuleTone;
  size?: ActionCapsuleSize;
  variant?: ActionCapsuleVariant;
  tableAction?: boolean;
}

const TONE_CLASS_MAP: Record<ActionCapsuleVariant, Record<ActionCapsuleTone, string>> = {
  soft: {
    blue: 'bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 text-blue-600 border-blue-200',
    green: 'bg-gradient-to-r from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 text-green-600 border-green-200',
    red: 'bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-600 border-red-200',
    amber: 'bg-gradient-to-r from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 text-amber-600 border-amber-200',
    slate: 'bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-200 text-slate-600 border-slate-200',
  },
  solid: {
    blue: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-700 text-white border-blue-600 shadow-sm',
    green: 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-700 text-white border-green-600 shadow-sm',
    red: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white border-red-500 shadow-sm',
    amber: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white border-amber-500 shadow-sm',
    slate: 'bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-700 text-white border-slate-600 shadow-sm',
  },
  neutral: {
    blue: 'bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] border-[#E2E8F0]',
    green: 'bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] border-[#E2E8F0]',
    red: 'bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] border-[#E2E8F0]',
    amber: 'bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] border-[#E2E8F0]',
    slate: 'bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] border-[#E2E8F0]',
  },
};

const SIZE_CLASS_MAP: Record<ActionCapsuleSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
};

export default function ActionCapsuleButton({
  icon,
  tone = 'blue',
  size = 'md',
  variant = 'soft',
  tableAction = false,
  className = '',
  type = 'button',
  children,
  ...props
}: ActionCapsuleButtonProps) {
  const tableActionClasses = tableAction
    ? [
        'h-8 min-w-[68px] rounded-[12px] px-3 text-[13px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        variant === 'soft' && tone === 'blue' && 'bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#2F6BFF] border-[#BFDBFE]',
        variant === 'soft' && tone === 'green' && 'bg-[#ECFDF3] hover:bg-[#D1FADF] text-[#12B76A] border-[#ABEFC6]',
        variant === 'soft' && tone === 'red' && 'bg-[#FEF3F2] hover:bg-[#FEE4E2] text-[#F04438] border-[#FECDCA]',
        variant === 'soft' && tone === 'amber' && 'bg-[#FFF7ED] hover:bg-[#FFEDD5] text-[#EA580C] border-[#FED7AA]',
        variant === 'soft' && tone === 'slate' && 'bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  const classes = [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition-all duration-200',
    tableAction ? 'rounded-[12px]' : 'rounded-xl',
    tableAction ? tableActionClasses : TONE_CLASS_MAP[variant][tone],
    tableAction ? '' : SIZE_CLASS_MAP[size],
    tableAction
      ? 'disabled:bg-[#F8FAFC] disabled:text-[#98A2B3] disabled:border-[#EAECF0] disabled:shadow-none disabled:cursor-not-allowed'
      : 'disabled:bg-[#F8FAFC] disabled:text-[#A0AEC0] disabled:border-[#E2E8F0] disabled:shadow-none disabled:cursor-not-allowed',
    className,
  ].join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {icon}
      {children}
    </button>
  );
}
