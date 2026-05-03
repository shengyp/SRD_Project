import type { LucideIcon } from 'lucide-react';

interface PaperStatCardProps {
  label: string;
  value: number | string;
  note: string;
  icon: LucideIcon;
  tone?: 'blue' | 'cyan' | 'green' | 'red' | 'slate';
}

const toneMap = {
  blue: {
    badge: 'bg-[#EEF4FF] text-[#2F6BFF]',
    note: 'text-[#2F6BFF]',
  },
  cyan: {
    badge: 'bg-[#EDF7FF] text-[#3173A8]',
    note: 'text-[#3173A8]',
  },
  green: {
    badge: 'bg-[#EEF9F2] text-[#2F7D59]',
    note: 'text-[#2F7D59]',
  },
  red: {
    badge: 'bg-[#FFF1EF] text-[#D9485F]',
    note: 'text-[#D9485F]',
  },
  slate: {
    badge: 'bg-[#F2F5F9] text-[#54657A]',
    note: 'text-[#54657A]',
  },
} as const;

export default function PaperStatCard({
  label,
  value,
  note: _note,
  icon: Icon,
  tone = 'blue',
}: PaperStatCardProps) {
  const palette = toneMap[tone];

  return (
    <div className="rounded-[20px] border border-[#E2E8F0] bg-white px-4 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition-colors duration-200 hover:border-[#D7E3F4]">
      <div className="flex items-center gap-3">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${palette.badge}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold tracking-[0.08em] text-[#8A97A8]">
            {label}
          </p>
          <div className="mt-1 text-[18px] font-semibold leading-none text-[#162033] md:text-[20px]">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}
