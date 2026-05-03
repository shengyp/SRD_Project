import { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Users,
  ListChecks,
  FileText,
  Settings,
  MessageCircle,
  UserSquare2,
  ShieldCheck,
  MapPin,
} from 'lucide-react';
import { fetchHomeCards, fetchHomeStats } from '../api';
import type { FunctionCard, HomeStats } from '../api';
import PaperStatCard from '../components/PaperStatCard';
import TrendChart from '../components/TrendChart';

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Settings,
  BookOpen,
  MessageCircle,
  UserSquare2,
  ListChecks,
  ShieldCheck,
  MapPin,
};

export default function HomePage() {
  const navigate = useNavigate();

  const [functionCards, setFunctionCards] = useState<FunctionCard[]>([]);
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [, setLoadingCards] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    fetchHomeCards()
      .then((cards) => {
        if (cards && cards.length > 0) {
          setFunctionCards(cards);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingCards(false));
  }, []);

  useEffect(() => {
    fetchHomeStats()
      .then((stats) => {
        setHomeStats(stats);
      })
      .catch(console.error)
      .finally(() => setLoadingStats(false));
  }, []);

  const handleCardClick = (route: string) => {
    if (route) {
      navigate(route);
    }
  };

  const statCards = [
    {
      label: '知识库文档',
      value: homeStats?.knowledgeBaseDocs ?? 0,
      icon: BookOpen,
      tone: 'blue' as const,
      note: '支撑问答检索、证据追溯与图谱构建',
    },
    {
      label: '总档案数',
      value: homeStats?.totalArchives ?? 0,
      icon: Users,
      tone: 'cyan' as const,
      note: '覆盖样本档案、个体画像与随访记录',
    },
    {
      label: '总量表数',
      value: homeStats?.totalScales ?? 0,
      icon: ListChecks,
      tone: 'green' as const,
      note: '支撑 PHQ-9、GAD-7 等量化评估环节',
    },
    {
      label: '报告生成数',
      value: homeStats?.reportsGenerated ?? 0,
      icon: FileText,
      tone: 'slate' as const,
      note: '形成检测摘要、汇报材料与干预建议输出',
    },
  ];

  const riskDist = homeStats?.riskDistribution;
  const totalRisk = riskDist
    ? (riskDist.low?.count ?? 0) + (riskDist.medium?.count ?? 0) + (riskDist.high?.count ?? 0)
    : 0;
  const lowPct = riskDist?.low?.percentage ?? 0;
  const mediumPct = riskDist?.medium?.percentage ?? 0;
  const highPct = riskDist?.high?.percentage ?? 0;

  const CIRCUMFERENCE = 100;
  const lowDash = (lowPct / 100) * CIRCUMFERENCE;
  const mediumDash = (mediumPct / 100) * CIRCUMFERENCE;
  const highDash = (highPct / 100) * CIRCUMFERENCE;
  const lowOffset = 0;
  const mediumOffset = -lowDash;
  const highOffset = -(lowDash + mediumDash);

  return (
    <div className="flex w-full flex-col gap-4 animate-fade-in md:gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => (
          <PaperStatCard
            key={stat.label}
            label={stat.label}
            value={loadingStats ? '-' : stat.value.toLocaleString()}
            note={stat.note}
            icon={stat.icon}
            tone={stat.tone}
          />
        ))}
      </div>

      <div className="rounded-[28px] border border-[#E2E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] md:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#162033]">功能入口卡片展</h2>
          <p className="mt-1 text-sm text-[#6B7B8F]">
            以论文演示链路组织系统入口，快速进入问答、知识、档案、量表与风险检测模块。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {functionCards.map((card) => {
            const IconComponent = ICON_MAP[card.cardIcon] || Settings;
            return (
              <button
                key={card.id || card.cardKey}
                onClick={() => handleCardClick(card.cardRoute)}
                className="group flex items-center gap-4 rounded-2xl border border-[#E2E8F0] bg-[#FBFDFF] p-5 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#CFE0FF] hover:shadow-[0_16px_32px_rgba(15,23,42,0.08)]"
              >
                <div
                  className="rounded-xl p-3 transition-transform duration-200 group-hover:scale-110"
                  style={{ background: card.cardBg || '#EEF4FF' }}
                >
                  <IconComponent className="h-6 w-6" style={{ color: card.cardColor || '#2F6BFF' }} />
                </div>
                <span className="whitespace-nowrap font-semibold text-[#162033]">{card.cardLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 items-stretch gap-4 md:gap-6 lg:min-h-[320px] lg:grid-cols-12">
        <div className="flex h-full min-h-[280px] flex-col rounded-[28px] border border-[#E2E8F0] bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.04)] md:p-8 lg:col-span-5 lg:min-h-0">
          <h2
            className="mb-4 shrink-0 border-b border-[#DCE7F5] pb-3 text-xl font-semibold text-[#162033]"
          >
            系统介绍与可视化概览
          </h2>
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-[#334155]">系统简介与核心价值</h3>
              <ul className="space-y-3 text-sm leading-relaxed text-[#516276]">
                <li className="flex gap-3">
                  <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2F6BFF]" />
                  <p><strong className="font-semibold text-[#415168]">跨学科智能融合：</strong>整合心理学专业知识与深度学习技术，实现心理数据的智能化分析与可视化呈现。</p>
                </li>
                <li className="flex gap-3">
                  <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2F6BFF]" />
                  <p><strong className="font-semibold text-[#415168]">双模型并行检测：</strong>融合 FeaLearner 风险预测与 Emoji 情绪分析，提供多维度、高精度的自杀风险评估。</p>
                </li>
                <li className="flex gap-3">
                  <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2F6BFF]" />
                  <p><strong className="font-semibold text-[#415168]">量表辅助诊断：</strong>集成 PHQ-9、GAD-7 等专业心理量表，结合智能问答系统，实现筛查、评估、干预全流程支持。</p>
                </li>
                <li className="flex gap-3">
                  <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2F6BFF]" />
                  <p><strong className="font-semibold text-[#415168]">专业可信：</strong>面向临床医生设计，辅助专业决策，数据仅作参考，建议以面对面评估为准。</p>
                </li>
              </ul>
            </div>
            <p className="shrink-0 border-t border-[rgba(148,163,184,.25)] pt-2 text-xs text-[#94A3B8]">
              专业工具辅助临床决策，数据仅作参考，请以面对面评估为准。
            </p>
          </div>
        </div>

        <div className="flex h-full min-h-[300px] flex-col gap-4 rounded-[28px] border border-[#E2E8F0] bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.04)] md:gap-5 md:p-8 md:pb-10 lg:col-span-7 lg:min-h-0">
          <h2 className="shrink-0 text-xl font-semibold text-[#162033]">数据概览与能力展示</h2>

          <div className="grid h-[320px] flex-none grid-cols-1 gap-5 md:h-[360px] md:grid-cols-3">
            <div className="col-span-2 flex flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white px-5 pb-8 pt-5 md:px-6 md:pb-10 md:pt-6">
              <h4 className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7B8F]">
                Risk Trend
              </h4>
              <div className="flex flex-1 items-center justify-center">
                {loadingStats ? (
                  <div className="text-sm text-[#94A3B8]">加载中...</div>
                ) : (
                  <TrendChart />
                )}
              </div>
            </div>

            <div className="col-span-1 flex flex-col items-center overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white px-5 pb-8 pt-5 md:px-6 md:pb-10 md:pt-6">
              <h4 className="mb-4 w-full shrink-0 text-left text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7B8F]">
                Risk Distribution
              </h4>
              <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
                {loadingStats ? (
                  <div className="text-sm text-[#94A3B8]">加载中...</div>
                ) : totalRisk === 0 ? (
                  <div className="text-sm text-[#94A3B8]">暂无数据</div>
                ) : (
                  <>
                    <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90 transform">
                      {lowDash > 0 && (
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke="#7EB88E"
                          strokeWidth="12"
                          strokeDasharray={`${lowDash} ${CIRCUMFERENCE - lowDash}`}
                          strokeDashoffset={lowOffset}
                        />
                      )}
                      {mediumDash > 0 && (
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke="#2F6BFF"
                          strokeWidth="12"
                          strokeDasharray={`${mediumDash} ${CIRCUMFERENCE - mediumDash}`}
                          strokeDashoffset={mediumOffset}
                        />
                      )}
                      {highDash > 0 && (
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke="#D9533A"
                          strokeWidth="12"
                          strokeDasharray={`${highDash} ${CIRCUMFERENCE - highDash}`}
                          strokeDashoffset={highOffset}
                        />
                      )}
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-[10px] text-[#94A3B8]">总检测</span>
                      <span className="text-sm font-semibold text-[#162033]">{totalRisk.toLocaleString()}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 mb-2 flex w-full shrink-0 flex-col gap-2 px-4 text-[10px] text-[#64748B]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#7EB88E]" />
                    低风险
                  </span>
                  <span className="font-medium">{loadingStats ? '-' : `${lowPct}%`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#2F6BFF]" />
                    中风险
                  </span>
                  <span className="font-medium">{loadingStats ? '-' : `${mediumPct}%`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#D9533A]" />
                    高风险
                  </span>
                  <span className="font-medium">{loadingStats ? '-' : `${highPct}%`}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
