import type { ReactNode } from 'react';

interface PaperSectionHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}

interface PaperHeaderMetaItemProps {
  label: string;
  value: ReactNode;
}

interface PaperHeaderMetaGroupProps {
  items: PaperHeaderMetaItemProps[];
}

export function PaperHeaderMetaGroup({ items }: PaperHeaderMetaGroupProps) {
  return (
    <div className="flex flex-col items-start gap-3 lg:items-end">
      <div className="flex flex-wrap gap-6 lg:justify-end">
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-[156px] border-l border-[#DCE6F4] pl-4 first:border-l-0 first:pl-0 lg:min-w-[172px]"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#94A3B8]">
              {item.label}
            </div>
            <div className="mt-1.5 text-sm font-medium leading-6 text-[#334155]">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PaperSectionHeader({
  eyebrow,
  title,
  description,
  aside,
}: PaperSectionHeaderProps) {
  return (
    <div className="flex flex-col gap-4 px-1 py-1">
      <div className="inline-flex items-center self-start rounded-full border border-[#D8E6FF] bg-[#F7FAFF] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2F6BFF]">
        {eyebrow}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-[26px] font-semibold tracking-[0.01em] text-[#162033] md:text-[30px]">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-8 text-[#5B6B7F] md:text-[15px]">
            {description}
          </p>
        </div>
        {aside ? <div className="shrink-0 pt-1">{aside}</div> : null}
      </div>
    </div>
  );
}
