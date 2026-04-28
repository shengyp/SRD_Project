import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HeartPulse,
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
import TrendChart from '../components/TrendChart';

// Lucide 图标映射表（支持从后端 cardIcon 字符串动态加载）
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Settings,
  BookOpen,
  MessageCircle,
  UserSquare2,
  ListChecks,
  ShieldCheck,
  MapPin,
};

// ==================== 组件实现 ====================

export default function HomePage() {
  const navigate = useNavigate();

  const [functionCards, setFunctionCards] = useState<FunctionCard[]>([]);
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [, setLoadingCards] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);

  // 从后端 API 加载功能卡片
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

  // 从后端 API 加载首页统计数据
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

  // 统计卡片数据（从 API 获取，若未加载则显示占位）
  const statCards = [
    {
      label: '知识库文档',
      value: homeStats?.knowledgeBaseDocs ?? 0,
      icon: BookOpen,
      bg: 'bg-[#FCE4D0]',
      textColor: 'text-[#C85F26]',
      cardBg: 'bg-[#FFF7EE]',
      borderColor: 'border-[#F5D9C0]',
    },
    {
      label: '总档案数',
      value: homeStats?.totalArchives ?? 0,
      icon: Users,
      bg: 'bg-[#DDE8F2]',
      textColor: 'text-[#5A7FA0]',
      cardBg: 'bg-[#F4FBFA]',
      borderColor: 'border-[#B5D4E8]',
    },
    {
      label: '总量表数',
      value: homeStats?.totalScales ?? 0,
      icon: ListChecks,
      bg: 'bg-[#E2F0E6]',
      textColor: 'text-[#5A8F6A]',
      cardBg: 'bg-[#FFF8F0]',
      borderColor: 'border-[#C5DFC5]',
    },
    {
      label: '报告生成数',
      value: homeStats?.reportsGenerated ?? 0,
      icon: FileText,
      bg: 'bg-[#FBDDD3]',
      textColor: 'text-[#D9533A]',
      cardBg: 'bg-[#FDF6F5]',
      borderColor: 'border-[#F5C5BB]',
    },
  ];

  // 风险分布数据（从 API 获取）
  const riskDist = homeStats?.riskDistribution;
  const totalRisk = riskDist
    ? (riskDist.low?.count ?? 0) + (riskDist.medium?.count ?? 0) + (riskDist.high?.count ?? 0)
    : 0;
  const lowPct = riskDist?.low?.percentage ?? 0;
  const mediumPct = riskDist?.medium?.percentage ?? 0;
  const highPct = riskDist?.high?.percentage ?? 0;

  // 环形图 strokeDasharray 计算（基于百分比）
  const CIRCUMFERENCE = 100; // 简化的周长
  const lowDash = (lowPct / 100) * CIRCUMFERENCE;
  const mediumDash = (mediumPct / 100) * CIRCUMFERENCE;
  const highDash = (highPct / 100) * CIRCUMFERENCE;
  const lowOffset = 0;
  const mediumOffset = -lowDash;
  const highOffset = -(lowDash + mediumDash);

  return (
    <div className="flex flex-col w-full gap-4 md:gap-6 animate-fade-in">
      {/* Hero Banner - 暖色调心理学主题 */}
      <div 
        className="relative shrink-0 overflow-hidden rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, #FDEEDC 0%, #FBD9BE 45%, #F9B98A 100%)',
          padding: '48px 40px',
          boxShadow: '0 16px 44px rgba(200,120,60,.22), inset 0 1px 0 rgba(255,255,255,.6)',
          border: '1px solid #F5DECC'
        }}
      >
        {/* 阳光光斑动画 */}
        <div 
          className="absolute w-80 h-80 rounded-full"
          style={{
            top: '-100px',
            right: '-80px',
            background: 'radial-gradient(circle,rgba(255,255,255,.55) 0,rgba(255,255,255,.15) 45%,transparent 70%)',
            animation: 'sunshine 6s ease-in-out infinite'
          }}
        />
        <div 
          className="absolute w-60 h-60 rounded-full"
          style={{
            bottom: '-80px',
            left: '-40px',
            background: 'rgba(255,255,255,.18)'
          }}
        />

        <div className="relative z-10 flex flex-col items-center justify-center text-center gap-6">
          <div 
            className="flex items-center justify-center w-24 h-24 rounded-full"
            style={{
              background: 'rgba(255,255,255,.78)',
              boxShadow: '0 10px 30px rgba(200,120,60,.28), inset 0 2px 4px rgba(255,255,255,.6)',
              animation: 'pulse 2.5s ease-in-out infinite'
            }}
          >
            <HeartPulse className="w-14 h-14 text-[#E07338]" />
          </div>
          <div>
            <h1 
              className="text-3xl md:text-4xl font-bold mb-3 tracking-wide"
              style={{ color: '#5C3A1A', textShadow: '0 2px 4px rgba(255,255,255,.4)' }}
            >
              VIS4SRD - 智能遇见，心灵港湾
            </h1>
            <p className="text-lg" style={{ color: '#5C4E42' }}>
              自杀风险检测系统，全方位守护心理健康
            </p>
          </div>
        </div>
      </div>

      {/* 功能入口卡片展（从后端 API 动态加载） */}
      <div className="shrink-0">
        <h2 className="text-lg font-bold mb-3 md:mb-4" style={{ color: '#4A3B32' }}>功能入口卡片展</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {functionCards.map((card) => {
            const IconComponent = ICON_MAP[card.cardIcon] || Settings;
            return (
              <button
                key={card.id || card.cardKey}
                onClick={() => handleCardClick(card.cardRoute)}
                className="flex items-center gap-4 p-5 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 group"
                style={{ border: '1px solid #F2E8E0' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#FBD9BE';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(200,120,60,.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#F2E8E0';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)';
                }}
              >
                <div className={`p-3 rounded-xl transition-transform duration-200 group-hover:scale-110`} style={{ background: card.cardBg || '#FCE4D0' }}>
                  <IconComponent className="w-6 h-6" style={{ color: card.cardColor || '#C85F26' }} />
                </div>
                <span className="font-semibold whitespace-nowrap" style={{ color: '#5A4B42' }}>{card.cardLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部两列：不占满剩余视口，避免 flex 压缩导致图表被裁切；由 Layout main 纵向滚动 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 items-stretch shrink-0 lg:min-h-[320px]">

        {/* 左侧：系统介绍 */}
        <div 
          className="lg:col-span-5 rounded-3xl p-6 md:p-8 flex flex-col min-h-[280px] lg:min-h-0 h-full"
          style={{ 
            background: '#FDF9F6', 
            boxShadow: '0 4px 16px rgba(200,120,60,.08)',
            border: '1px solid #F2E8E0'
          }}
        >
          <h2 
            className="text-xl font-bold mb-4 pb-3 shrink-0"
            style={{ color: '#4A3B32', borderBottom: '1px solid #FBD9BE' }}
          >
            系统介绍与可视化概览
          </h2>
          <div className="flex-1 flex flex-col justify-between gap-4 min-h-0">
            <div className="space-y-3">
              <h3 className="font-bold text-lg" style={{ color: '#5A4B42' }}>系统简介与核心价值</h3>
              <ul className="space-y-3 leading-relaxed text-sm" style={{ color: '#6A5B52' }}>
                <li className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: '#F2935A' }}></div>
                  <p><strong className="font-semibold" style={{ color: '#5A4B42' }}>跨学科智能融合：</strong>整合心理学专业知识与深度学习技术，实现心理数据的智能化分析与可视化呈现。</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: '#F2935A' }}></div>
                  <p><strong className="font-semibold" style={{ color: '#5A4B42' }}>双模型并行检测：</strong>融合 FeaLearner 风险预测与 Emoji 情绪分析，提供多维度、高精度的自杀风险评估。</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: '#F2935A' }}></div>
                  <p><strong className="font-semibold" style={{ color: '#5A4B42' }}>量表辅助诊断：</strong>集成 PHQ-9、GAD-7 等专业心理量表，结合智能问答系统，实现筛查-评估-干预全流程支持。</p>
                </li>
                <li className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: '#F2935A' }}></div>
                  <p><strong className="font-semibold" style={{ color: '#5A4B42' }}>专业可信：</strong>面向临床医生设计，辅助专业决策，数据仅作参考，建议以面对面评估为准。</p>
                </li>
              </ul>
            </div>
            <p 
              className="text-xs pt-2 shrink-0"
              style={{ color: '#9A8B82', borderTop: '1px solid rgba(255,183,155,.3)' }}
            >
              专业工具辅助临床决策，数据仅作参考，请以面对面评估为准。
            </p>
          </div>
        </div>

        {/* 右侧：数据概览 */}
        <div 
          className="lg:col-span-7 rounded-3xl p-6 md:p-8 pb-8 md:pb-10 flex flex-col gap-4 md:gap-5 min-h-[300px] lg:min-h-0 h-full"
          style={{ 
            background: '#FDF9F6', 
            boxShadow: '0 4px 16px rgba(200,120,60,.08)',
            border: '1px solid #F2E8E0'
          }}
        >
          <h2 className="text-xl font-bold shrink-0" style={{ color: '#4A3B32' }}>数据概览与能力展示</h2>

          {/* 统计卡片（从 API 动态加载） */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 shrink-0">
            {statCards.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <div 
                  key={idx} 
                  className="p-4 rounded-2xl transition-all duration-200"
                  style={{ 
                    background: stat.cardBg, 
                    border: `1px solid ${stat.borderColor}`
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-medium" style={{ color: '#8A6455' }}>{stat.label}</span>
                    <div className={`p-1.5 rounded-lg`} style={{ background: stat.bg }}>
                      <Icon className={`w-4 h-4`} style={{ color: stat.textColor }} />
                    </div>
                  </div>
                  <div className="text-2xl font-black" style={{ color: '#4A3B32' }}>
                    {loadingStats ? '-' : stat.value.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 图表区 */}
          <div className="flex-none h-[320px] md:h-[360px] grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 折线图（从 API 动态加载趋势数据） */}
            <div 
              className="col-span-2 rounded-2xl pt-5 px-5 pb-8 md:pt-6 md:px-6 md:pb-10 flex flex-col overflow-hidden"
              style={{ 
                background: '#fff', 
                border: '1px solid #F5E8E0'
              }}
            >
              <h4 className="text-xs font-bold mb-4 shrink-0" style={{ color: '#6B5A4E' }}>各时段风险监测任务数目趋势</h4>
              <div className="flex-1 flex items-center justify-center">
                {loadingStats ? (
                  <div className="text-sm" style={{ color: '#B5A89C' }}>加载中...</div>
                ) : (
                  <TrendChart />
                )}
              </div>
            </div>

            {/* 环形图（从 API 动态加载风险分布） */}
            <div 
              className="col-span-1 rounded-2xl pt-5 px-5 pb-8 md:pt-6 md:px-6 md:pb-10 flex flex-col items-center overflow-hidden"
              style={{ 
                background: '#fff', 
                border: '1px solid #F5E8E0'
              }}
            >
              <h4 className="text-xs font-bold mb-4 w-full text-left shrink-0" style={{ color: '#6B5A4E' }}>风险等级分布</h4>
              <div className="flex-1 flex items-center justify-center relative w-full min-h-0">
                {loadingStats ? (
                  <div className="text-sm" style={{ color: '#B5A89C' }}>加载中...</div>
                ) : totalRisk === 0 ? (
                  <div className="text-sm" style={{ color: '#B5A89C' }}>暂无数据</div>
                ) : (
                  <>
                    <svg viewBox="0 0 100 100" className="w-24 h-24 transform -rotate-90">
                      {lowDash > 0 && (
                        <circle 
                          cx="50" cy="50" r="40" 
                          fill="transparent" 
                          stroke="#7EB88E" 
                          strokeWidth="12"
                          strokeDasharray={`${lowDash} ${CIRCUMFERENCE - lowDash}`}
                          strokeDashoffset={lowOffset} 
                        />
                      )}
                      {mediumDash > 0 && (
                        <circle 
                          cx="50" cy="50" r="40" 
                          fill="transparent" 
                          stroke="#F2935A" 
                          strokeWidth="12"
                          strokeDasharray={`${mediumDash} ${CIRCUMFERENCE - mediumDash}`}
                          strokeDashoffset={mediumOffset} 
                        />
                      )}
                      {highDash > 0 && (
                        <circle 
                          cx="50" cy="50" r="40" 
                          fill="transparent" 
                          stroke="#D9533A" 
                          strokeWidth="12"
                          strokeDasharray={`${highDash} ${CIRCUMFERENCE - highDash}`}
                          strokeDashoffset={highOffset} 
                        />
                      )}
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-[10px]" style={{ color: '#B5A89C' }}>总检测</span>
                      <span className="text-sm font-bold" style={{ color: '#4A3B32' }}>{totalRisk.toLocaleString()}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 mt-4 mb-2 px-4 text-[8px] w-full shrink-0" style={{ color: '#8A7A6A' }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: '#7EB88E' }}></span> 
                    低风险
                  </span>
                  <span className="font-medium">{loadingStats ? '-' : `${lowPct}%`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: '#F2935A' }}></span> 
                    中风险
                  </span>
                  <span className="font-medium">{loadingStats ? '-' : `${mediumPct}%`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: '#D9533A' }}></span> 
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
