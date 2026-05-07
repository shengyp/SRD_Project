import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import {
  Clock, Filter, Search, FileText,
  Activity, MessageSquare, ArrowLeft,
  FilterX, Info, Star, AlertTriangle, BookOpen, ChevronDown
} from 'lucide-react';
import { fetchArchiveDetail, fetchCSVUserKeywords, fetchDatasets, DatasetProfile } from '../api';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

// ==================== 类型定义 ====================

interface ArchiveRecord {
  id: string;
  userId: string;
  userHash?: string;
  dataSource?: string;
  datasetSource?: string;
  gender?: string;
  age?: number;
  postCount?: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'unknown' | string;
  riskOverview?: '高风险' | '中风险' | '低风险' | '待判定';
  importTime?: string;
  lastActive?: string;
  recordCount?: number;
  status?: 'importing' | 'ready' | 'analyzing';
}

interface PostRecord {
  id: string;
  userId: string;
  postIndex: number;
  content: string;
  importanceScore: number;
  riskLevel?: 'low' | 'medium' | 'high';
  riskScore: number;
  suicideRisk?: number | string;
  timestamp?: string;
  hasTimestamp: boolean;
  microExpressions?: string[];
  evidenceDomains?: Array<{
    key: string;
    label: string;
    matches: string[];
    count: number;
  }>;
  evidenceSummary?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

function hasUsableTimestamp(post: Pick<PostRecord, 'timestamp' | 'hasTimestamp'>): boolean {
  return Boolean(post.timestamp && post.timestamp.trim()) || post.hasTimestamp;
}

function formatTimestampLabel(timestamp?: string): string {
  if (!timestamp) return '';
  const [datePart = '', timePart = ''] = timestamp.split(' ');
  return timePart ? `${datePart}\n${timePart}` : datePart;
}

function mapRiskLevelToChinese(level?: string): '高风险' | '中风险' | '低风险' | '待判定' {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  if (level === 'low') return '低风险';
  return '待判定';
}

function mapFineLabelToRiskLevel(label: number, datasetSource: string): 'low' | 'medium' | 'high' {
  const source = datasetSource.toLowerCase();
  if (source === 'reddit') {
    if (label >= 4) return 'high';
    if (label >= 2) return 'medium';
    return 'low';
  }
  if (source === 'bigdata') {
    if (label >= 3) return 'high';
    if (label >= 2) return 'medium';
    return 'low';
  }
  if (source === 'sigir' || source === 'weibo') {
    return label >= 1 ? 'high' : 'low';
  }
  if (label >= 3) return 'high';
  if (label >= 2) return 'medium';
  return 'low';
}

function formatPostIndexLabel(postIndex: number, compact = false): string {
  const normalized = Number.isFinite(postIndex) ? String(postIndex).padStart(2, '0') : '--';
  return compact ? `P${normalized}` : `帖子 ${normalized}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedContent(content: string, evidenceDomains?: PostRecord['evidenceDomains']) {
  if (!content) return null;

  const keywords = Array.from(new Set(
    (evidenceDomains || [])
      .flatMap((domain) => domain.matches || [])
      .filter(Boolean)
  )).sort((a, b) => b.length - a.length);

  if (keywords.length === 0) {
    return content;
  }

  const pattern = new RegExp(`(${keywords.map((item) => escapeRegExp(item)).join('|')})`, 'ig');
  const parts = content.split(pattern);

  return parts.map((part, index) => {
    const matched = keywords.find((keyword) => keyword.toLowerCase() === part.toLowerCase());
    if (!matched) {
      return <span key={`text-${index}`}>{part}</span>;
    }
    return (
      <mark
        key={`hit-${index}`}
        className="rounded-md bg-[#FFF3BF] px-1 py-0.5 text-[#92400E]"
      >
        {part}
      </mark>
    );
  });
}

// ==================== 常量配置 ====================

const DATA_SOURCES = [
  { value: 'reddit', label: 'Reddit系列' },
  { value: 'bigdata', label: 'Bigdata系列' },
  { value: 'sigir', label: 'SIGIR系列' },
  { value: 'weibo', label: 'Weibo系列' },
];

const DATA_SOURCE_COLORS: Record<string, string> = {
  reddit: 'bg-[#E8F0FF] text-[#2F6BFF]',
  bigdata: 'bg-[#EEF7FF] text-[#0F6CBD]',
  sigir: 'bg-[#F5F0FF] text-[#7C3AED]',
  weibo: 'bg-[#FFF4E8] text-[#EA580C]',
};

const RISK_COLORS = {
  low: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', badge: 'bg-green-500', light: 'bg-green-50' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', badge: 'bg-yellow-500', light: 'bg-yellow-50' },
  high: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', badge: 'bg-red-500', light: 'bg-red-50' },
};

// ==================== 主页面组件 ====================

export default function ArchiveDetailPage() {
  const navigate = useNavigate();
  const params = useParams();
  const archiveId = params.archiveId;

  // 状态
  const [selectedArchive, setSelectedArchive] = useState<ArchiveRecord | null>(null);
  const [selectedPost, setSelectedPost] = useState<PostRecord | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [topN, setTopN] = useState(3);
  const [timeRange, setTimeRange] = useState({ start: '', end: '' });
  const [importanceFilter, setImportanceFilter] = useState('all');
  const [postIndexFilter, setPostIndexFilter] = useState('');
  // 默认显示前15条帖子
  const [visiblePostCount, setVisiblePostCount] = useState(15);
  // 加载更多状态
  const [isLoadingMore] = useState(false);

  // 动态数据源配置（从 API 加载）
  const [dataSourceOptions, setDataSourceOptions] = useState<{ value: string; label: string }[]>(DATA_SOURCES);
  const [dataSourceColors, setDataSourceColors] = useState<Record<string, string>>({ ...DATA_SOURCE_COLORS });

  // 初始化数据（从后端 API 加载）
  useEffect(() => {
    // 加载数据集配置
    fetchDatasets()
      .then((datasets) => {
        if (datasets && datasets.length > 0) {
          const defaultColorMap: Record<string, string> = {
            reddit: 'bg-[#E8F0FF] text-[#2F6BFF]',
            bigdata: 'bg-[#EEF7FF] text-[#0F6CBD]',
            sigir: 'bg-[#F5F0FF] text-[#7C3AED]',
            weibo: 'bg-[#FFF4E8] text-[#EA580C]',
          };
          const colors: Record<string, string> = { ...defaultColorMap };
          datasets.forEach((ds: DatasetProfile) => {
            if (ds.color) {
              // 将 hex 颜色转为 tailwind bg/text 类（近似处理）
              colors[ds.datasetKey] = `bg-blue-100 text-blue-700`;
            }
          });
          setDataSourceOptions(
            datasets.map((ds: DatasetProfile) => ({ value: ds.datasetKey, label: ds.displayName }))
          );
          setDataSourceColors(colors);
        }
      })
      .catch((err) => {
        console.warn('加载数据集配置失败，使用默认值:', err);
      });
  }, []);


  // 初始化数据（从后端 API 加载）
  useEffect(() => {
    if (!archiveId) return;

    const savedArchive = sessionStorage.getItem('selectedArchive');
    if (savedArchive) {
      try {
        const archive = JSON.parse(savedArchive) as ArchiveRecord;
        const uid = archive.userId || archive.id;
        if (uid === archiveId) {
          setSelectedArchive(archive);
        }
      } catch (error) {
        console.warn('Failed to parse saved archive:', error);
      }
    }

    fetchArchiveDetail(archiveId)
      .then((detail) => {
        const datasetSource = detail.source || new URLSearchParams(window.location.search).get('dataset') || 'reddit';
        const resolvedArchive: ArchiveRecord = {
          id: detail.userId,
          userId: detail.userId,
          userHash: detail.userId,
          dataSource: datasetSource,
          datasetSource,
          postCount: detail.postCount,
          recordCount: detail.postCount,
          importTime: detail.assessmentTime,
          riskLevel: detail.riskLevel || 'unknown',
          riskOverview: mapRiskLevelToChinese(detail.riskLevel),
        };
        setSelectedArchive(resolvedArchive);

        const loadedPosts: PostRecord[] = (detail.posts || []).map((post, index) => {
          const label = Number(post.label ?? 0);
          const derivedRiskLevel = mapFineLabelToRiskLevel(label, datasetSource);
          return {
            id: post.id,
            userId: detail.userId,
            postIndex: index + 1,
            content: post.text || '',
            importanceScore: detail.posts.length - index,
            riskLevel: derivedRiskLevel,
            riskScore: detail.riskScore ?? 0.5,
            suicideRisk: label,
            timestamp: post.timestamp || undefined,
            hasTimestamp: Boolean(post.timestamp),
            status: 'accepted',
            evidenceDomains: [],
            evidenceSummary: '',
          };
        });

        setPosts(loadedPosts);
        setVisiblePostCount(15);
        const sorted = [...loadedPosts].sort((a, b) => b.importanceScore - a.importanceScore);
        setSelectedPost(sorted[0] || null);

        return fetchCSVUserKeywords({ datasetKey: datasetSource, userHash: archiveId, topN: 8 });
      })
      .then((res) => setFrequentWords(res.keywords.map((k) => k.word)))
      .catch((err) => {
        console.error('Failed to load archive detail:', err);
        setPosts([]);
        setSelectedPost(null);
        setFrequentWords([]);
      });
  }, [archiveId, params.archiveId]);

  // 高频词汇（从后端 API 实时获取）
  const [frequentWords, setFrequentWords] = useState<string[]>([]);

  // 根据筛选条件过滤帖子
  const filteredPosts = posts.filter(post => {
    // 重要性分数筛选
    if (importanceFilter === 'low' && (post.importanceScore >= 0.4 || !post.riskLevel)) return false;
    if (importanceFilter === 'medium' && (post.importanceScore < 0.4 || post.importanceScore >= 0.7)) return false;
    if (importanceFilter === 'high' && post.importanceScore < 0.7) return false;
    // 时间范围筛选
    if (timeRange.start && hasUsableTimestamp(post)) {
      const postDate = new Date(post.timestamp!);
      if (postDate < new Date(timeRange.start)) return false;
    }
    if (timeRange.end && hasUsableTimestamp(post)) {
      const postDate = new Date(post.timestamp!);
      if (postDate > new Date(timeRange.end)) return false;
    }
    // 帖子序号筛选
    if (postIndexFilter) {
      const filterNum = parseInt(postIndexFilter);
      if (!isNaN(filterNum) && post.postIndex !== filterNum) return false;
    }
    return true;
  });

  // 按重要性分数排序（用于 Top N 高亮）
  const sortedPosts = [...filteredPosts].sort((a, b) => b.importanceScore - a.importanceScore);
  const topPosts = sortedPosts.slice(0, topN);

  // 按时间/顺序递增排序（用于图表 X 轴：左旧右新）
  const chartPosts = [...filteredPosts].sort((a, b) => {
    const aHasTimestamp = hasUsableTimestamp(a);
    const bHasTimestamp = hasUsableTimestamp(b);
    if (aHasTimestamp && bHasTimestamp) {
      return new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime();
    }
    if (aHasTimestamp && !bHasTimestamp) return -1;
    if (!aHasTimestamp && bHasTimestamp) return 1;
    return a.postIndex - b.postIndex;
  });

// 可见帖子（用于图表显示，默认前15条）
const visiblePosts = chartPosts.slice(0, visiblePostCount);
const chartUsesTimestamp = visiblePosts.some(post => hasUsableTimestamp(post));

  const archiveRiskLabel = selectedArchive?.riskOverview || mapRiskLevelToChinese(selectedArchive?.riskLevel);
  const riskKey = archiveRiskLabel === '高风险' ? 'high' : archiveRiskLabel === '中风险' ? 'medium' : 'low';

  // 重置筛选
  const handleReset = () => {
    setTopN(3);
    setTimeRange({ start: '', end: '' });
    setImportanceFilter('all');
    setPostIndexFilter('');
  };

  // 获取重要性分数对应的背景色
  const getImportanceBgColor = (score: number): string => {
    if (score >= 0.7) return 'bg-[#E8F0FF]';
    if (score >= 0.4) return 'bg-yellow-100';
    return 'bg-green-100';
  };

  // 获取重要性分数对应的文字色
  const getImportanceTextColor = (score: number): string => {
    if (score >= 0.7) return 'text-[#2F6BFF]';
    if (score >= 0.4) return 'text-yellow-500';
    return 'text-green-500';
  };

  // 获取重要性分数对应的标签
  const getImportanceLabel = (score: number): string => {
    if (score >= 0.7) return '（高重要性）';
    if (score >= 0.4) return '（中重要性）';
    return '（低重要性）';
  };

  // 获取 Top 颜色（ECharts 用 hex）
  const getTopColorHex = (index: number): string => {
    if (index === 0) return '#ef4444';
    if (index === 1) return '#f97316';
    if (index === 2) return '#eab308';
    return '#8FB4FF';
  };

  if (!selectedArchive) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-[#64748B] mb-4">正在加载档案数据...</p>
          <ActionCapsuleButton onClick={() => navigate('/archive')} variant="solid">
            返回列表
          </ActionCapsuleButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-5 animate-fade-in">
      <div className="bg-white rounded-[28px] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl">
              <span className="text-sm font-medium text-[#415168]">当前已选：</span>
              <span className={`px-3 py-1 ${dataSourceColors[selectedArchive.dataSource]} text-xs rounded-full font-medium`}>
                {dataSourceOptions.find(d => d.value === selectedArchive.dataSource)?.label}
              </span>
              <span className="text-sm text-[#415168]">/</span>
              <span className="text-sm font-semibold text-[#162033]">{selectedArchive.userId}</span>
            </div>

            <ActionCapsuleButton
              onClick={() => navigate('/archive')}
              variant="neutral"
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              返回列表
            </ActionCapsuleButton>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${RISK_COLORS[riskKey].bg} ${RISK_COLORS[riskKey].text}`}>
              {archiveRiskLabel}
            </span>
            <span className="px-3 py-1.5 bg-[#F1F5FA] text-[#415168] rounded-full text-sm">
              共 {posts.length} 条帖子
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[28px] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-[#64748B]">
            <Clock className="w-4 h-4" />
            <span>当前用户贴文高频词：</span>
          </div>
          {frequentWords.length > 0 ? (
            frequentWords.map((word, i) => (
              <span key={i} className="px-3 py-1 bg-white border border-[#DCE7F5] text-[#2F6BFF] text-sm rounded-full font-medium hover:bg-blue-50 transition-colors cursor-default">
                {word}
              </span>
            ))
          ) : (
            <span className="text-sm text-[#94A3B8]">当前用户帖子里暂无可展示的高频词</span>
          )}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex flex-col gap-5">
        {/* 图表区：重要性分数随时间变化 */}
        <div className="bg-white rounded-[28px] border border-[#E2E8F0] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] shrink-0">
          <h3 className="text-base font-semibold text-[#162033] mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-[#2F6BFF]" />
            重要性分数随时间 / 帖子顺序变化
            <span className="text-xs font-normal text-[#64748B] ml-2">（柱状图高度对应重要性分数，分数越高越重要）</span>
          </h3>

          {/* 交互说明 */}
          <div className="flex flex-wrap gap-4 text-xs text-[#64748B] mb-4 p-3 bg-[#F7FAFD] rounded-xl">
            <span className="flex items-center gap-1"><Info className="w-3 h-3" /> 交互说明：</span>
            <span>• 悬停柱子：显示重要性分数、当前用户风险等级、摘要</span>
            <span>• 点击柱子：选中该帖子，下方显示详情</span>
            <span>• 颜色标识：Top 1(红) → Top 2(橙) → Top 3(黄) → 其他</span>
          </div>

          {/* ECharts 柱形图（正式 X/Y 轴） */}
          <div className="w-full min-h-[280px]">
            <ReactECharts
              option={{
                grid: { left: 50, right: 30, top: 40, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: visiblePosts.map(p => (
                    hasUsableTimestamp(p) ? formatTimestampLabel(p.timestamp) : formatPostIndexLabel(p.postIndex, true)
                  )),
                  axisLine: { lineStyle: { color: '#DCE7F5' } },
                  axisLabel: {
                    color: '#64748B',
                    fontSize: 11,
                    interval: 'auto',
                    hideOverlap: true,
                    lineHeight: 14,
                  },
                  name: chartUsesTimestamp ? '时间戳' : '帖子顺序',
                  nameLocation: 'middle',
                  nameGap: 35,
                  nameTextStyle: { color: '#64748B', fontSize: 11 },
                },
                yAxis: {
                  type: 'value',
                  min: 0,
                  max: 1,
                  interval: 0.2,
                  axisLine: { show: true, lineStyle: { color: '#DCE7F5' } },
                  splitLine: { lineStyle: { color: '#EAF0F6', type: 'dashed' } },
                  axisLabel: { color: '#64748B', fontSize: 11 },
                  name: '重要性分数',
                  nameLocation: 'middle',
                  nameGap: 40,
                  nameTextStyle: { color: '#64748B', fontSize: 11 },
                },
                tooltip: {
                  trigger: 'axis',
                  formatter: (params: unknown) => {
                    const items = params as { dataIndex?: number }[];
                    const idx = items[0]?.dataIndex;
                    if (idx == null || !visiblePosts[idx]) return '';
                    const p = visiblePosts[idx];
                    const topIdx = topPosts.findIndex(t => t.id === p.id);
                    const rank = topIdx >= 0 ? ` (Top ${topIdx + 1})` : '';
                    return `<div style="padding:4px 0">
                      <div><b>${hasUsableTimestamp(p) ? '时间戳' : '帖子序号'}</b>: ${hasUsableTimestamp(p) ? (p.timestamp || '-') : formatPostIndexLabel(p.postIndex)}</div>
                      <div><b>重要性分数</b>: ${p.importanceScore.toFixed(4)}</div>
                      <div><b>当前用户风险等级</b>: ${archiveRiskLabel}</div>
                      <div><b>证据域</b>: ${(p.evidenceDomains?.map((item) => item.label).join(' / ') || '未命中明显风险域')}</div>
                      <div><b>重要性排名</b>: ${rank || '其他'}</div>
                      <div style="margin-top:6px;font-size:11px;color:#888;max-width:200px;overflow:hidden;text-overflow:ellipsis">${p.content.slice(0, 50)}...</div>
                    </div>`;
                  },
                  backgroundColor: '#162033',
                  borderColor: 'transparent',
                  textStyle: { color: '#fff', fontSize: 12 },
                },
                series: [{
                  type: 'bar',
                  data: visiblePosts.map((post) => {
                    const topIndex = topPosts.findIndex(p => p.id === post.id);
                    return {
                      value: post.importanceScore,
                      itemStyle: {
                        color: getTopColorHex(topIndex >= 0 ? topIndex : -1),
                        borderColor: selectedPost?.id === post.id ? '#2F6BFF' : 'transparent',
                        borderWidth: selectedPost?.id === post.id ? 3 : 0,
                      },
                      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' } },
                    };
                  }),
                  barWidth: '50%',
                  barMaxWidth: 36,
                  markPoint: {
                    data: visiblePosts.map((post, idx) => {
                      const topIndex = topPosts.findIndex(p => p.id === post.id);
                      if (topIndex < 0) return null;
                      return {
                        name: `${topIndex + 1}`,
                        value: '',
                        xAxis: idx,
                        yAxis: post.importanceScore,
                        symbol: 'circle',
                        symbolSize: 22,
                        itemStyle: {
                          color: getTopColorHex(topIndex),
                          borderColor: '#fff',
                          borderWidth: 2,
                        },
                        label: {
                          show: true,
                          formatter: `${topIndex + 1}`,
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 'bold',
                        },
                      };
                    }).filter(Boolean),
                    symbolOffset: [0, -25],
                  },
                }],
              }}
              style={{ height: 280 }}
              notMerge
              onEvents={{
                click: (params: { dataIndex?: number }) => {
                  const idx = params?.dataIndex;
                  if (idx != null && visiblePosts[idx]) setSelectedPost(visiblePosts[idx]);
                },
              }}
            />
          </div>

          {/* 查看更多按钮 */}
          {filteredPosts.length > visiblePostCount && (
            <div className="flex justify-center mt-4">
              <ActionCapsuleButton
                onClick={() => setVisiblePostCount(prev => Math.min(prev + 15, filteredPosts.length))}
                disabled={isLoadingMore}
                variant="solid"
                size="lg"
                icon={<MessageSquare className="w-4 h-4" />}
              >
                {isLoadingMore ? '加载中...' : `查看更多帖子（还剩 ${filteredPosts.length - visiblePostCount} 条）`}
              </ActionCapsuleButton>
            </div>
          )}

          {/* 图例 */}
          <div className="flex items-center justify-center gap-6 mt-5 pt-4 border-t border-[#EAF0F6] text-sm">
            <span className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-gradient-to-r from-red-500 to-red-600"></span> Top1 最重要（分数最高）</span>
            <span className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-gradient-to-r from-blue-500 to-blue-600"></span> Top2</span>
            <span className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-gradient-to-r from-yellow-500 to-yellow-600"></span> Top3</span>
            <span className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-gradient-to-r from-[#BFD3F2] to-[#8FB4FF]"></span> 其他</span>
          </div>
        </div>

        {/* 筛选区 */}
        <div className="bg-white rounded-[28px] border border-[#E2E8F0] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] shrink-0">
          <h3 className="text-base font-semibold text-[#162033] mb-4 flex items-center gap-2">
            <Filter className="w-5 h-5 text-[#2F6BFF]" />
            筛选
            <span className="text-xs font-normal text-[#64748B] ml-2">（Top N 按重要性分数排序）</span>
          </h3>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#415168]">Top N：</label>
              <select
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="px-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <option key={n} value={n}>Top {n}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#415168]">时间范围：</label>
              <input
                type="date"
                value={timeRange.start}
                onChange={(e) => setTimeRange({ ...timeRange, start: e.target.value })}
                className="px-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-[#64748B]">至</span>
              <input
                type="date"
                value={timeRange.end}
                onChange={(e) => setTimeRange({ ...timeRange, end: e.target.value })}
                className="px-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#415168]">重要性分数：</label>
              <select
                value={importanceFilter}
                onChange={(e) => setImportanceFilter(e.target.value)}
                className="px-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                <option value="all">全部</option>
                <option value="high">高重要性 (≥0.7)</option>
                <option value="medium">中重要性 (0.4-0.7)</option>
                <option value="low">低重要性 (&lt;0.4)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#415168]">帖子序号：</label>
              <input
                type="text"
                value={postIndexFilter}
                onChange={(e) => setPostIndexFilter(e.target.value)}
                placeholder="如: 1-50 或 #5"
                className="px-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-28"
              />
            </div>
            <ActionCapsuleButton variant="solid" icon={<Search className="w-4 h-4" />}>
              筛选
            </ActionCapsuleButton>
            <ActionCapsuleButton
              onClick={handleReset}
              variant="neutral"
              icon={<FilterX className="w-4 h-4" />}
            >
              重置
            </ActionCapsuleButton>
          </div>
        </div>

        {/* 当前选中帖子详情 */}
        {selectedPost && (
          <div className="bg-white rounded-[28px] border border-[#E2E8F0] shadow-[0_10px_28px_rgba(15,23,42,0.04)] overflow-hidden shrink-0">
            <div className="px-5 py-3 bg-gradient-to-r from-[#F7FAFD] to-white border-b border-[#E2E8F0]">
              <h3 className="text-base font-semibold text-[#162033] flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#2F6BFF]" />
                当前选中帖子详情
                <span className="text-xs font-normal text-[#64748B]">（默认展示 Top 1 最重要帖子）</span>
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {/* 帖子信息卡片 */}
              <div className="bg-gradient-to-r from-[#F7FAFD] to-white rounded-2xl p-5 border border-[#DCE7F5]">
                <h4 className="font-semibold text-sm text-[#162033] mb-4 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#2F6BFF]" />
                  帖子信息
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl p-3 border border-[#E2E8F0]">
                    <p className="text-xs text-[#64748B] mb-1">用户ID</p>
                    <p className="font-semibold text-[#162033] text-sm font-mono">{selectedPost.userId}</p>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-[#E2E8F0]">
                    <p className="text-xs text-[#64748B] mb-1">帖子序号</p>
                    <span className="inline-flex items-center rounded-full border border-[#D6E4FA] bg-[#F8FBFF] px-3 py-1 text-sm font-semibold text-[#1D4ED8]">
                      {formatPostIndexLabel(selectedPost.postIndex)}
                    </span>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-[#E2E8F0]">
                    <p className="text-xs text-[#64748B] mb-1">重要性分数</p>
                    <p className="font-semibold text-[#162033] text-sm">{selectedPost.importanceScore.toFixed(2)}</p>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-[#E2E8F0]">
                    <p className="text-xs text-[#64748B] mb-1">发布时间</p>
                    <p className="font-semibold text-[#162033] text-sm">{selectedPost.timestamp || '无时间戳'}</p>
                  </div>
                </div>
              </div>

              {/* 重要性分数与风险等级 */}
              <div className="bg-gradient-to-r from-[#F7FAFD] to-white rounded-2xl p-5 border border-[#DCE7F5]">
                <h4 className="font-semibold text-sm text-[#162033] mb-4 flex items-center gap-2">
                  <Star className="w-4 h-4 text-[#2F6BFF]" />
                  重要性分数
                </h4>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${getImportanceBgColor(selectedPost.importanceScore)}`}>
                      <Star className={`w-7 h-7 ${getImportanceTextColor(selectedPost.importanceScore)}`} />
                    </div>
                    <div>
                      <span className={`text-xl font-bold ${selectedPost.importanceScore >= 0.7 ? 'text-[#2F6BFF]' : selectedPost.importanceScore >= 0.4 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {selectedPost.importanceScore.toFixed(4)}
                      </span>
                      <span className="text-[#64748B] ml-2">
                        {getImportanceLabel(selectedPost.importanceScore)}
                      </span>
                    </div>
                  </div>
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${RISK_COLORS[riskKey].light}`}>
                    <AlertTriangle className={`w-7 h-7 ${RISK_COLORS[riskKey].text}`} />
                  </div>
                  <div className={`rounded-2xl border px-4 py-3 ${RISK_COLORS[riskKey].light} ${RISK_COLORS[riskKey].border}`}>
                    <p className="text-xs text-[#64748B] mb-1">当前用户风险等级</p>
                    <p className={`text-base font-semibold ${RISK_COLORS[riskKey].text}`}>{archiveRiskLabel}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-[#E2E8F0] bg-white p-4">
                  <p className="text-xs font-medium text-[#64748B] mb-2">风险证据摘要</p>
                  <p className="text-sm text-[#334155] leading-6">
                    {selectedPost.evidenceSummary || '当前帖子未命中明显风险证据域。'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedPost.evidenceDomains && selectedPost.evidenceDomains.length > 0) ? (
                      selectedPost.evidenceDomains.map((domain) => (
                        <span
                          key={domain.key}
                          className="inline-flex items-center gap-2 rounded-full border border-[#D6E4FA] bg-[#F8FBFF] px-3 py-1.5 text-xs font-medium text-[#1D4ED8]"
                          title={domain.matches.join(', ')}
                        >
                          <span>{domain.label}</span>
                          <span className="text-[#64748B]">{domain.matches.slice(0, 2).join(' / ')}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-[#94A3B8]">未识别到明显风险词汇</span>
                    )}
                  </div>
                </div>
                <details className="mt-4 rounded-2xl border border-[#DCE7F5] bg-[#FBFDFF] p-4 group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[#2F6BFF]" />
                      <span className="text-sm font-semibold text-[#162033]">理论依据</span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-[#64748B] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-4 space-y-3 text-sm text-[#415168] leading-6">
                    <div className="rounded-xl border border-[#EAF0F6] bg-white p-3">
                      <p className="font-semibold text-[#162033]">ASQ</p>
                      <p className="mt-1">
                        参考 NIMH 的 Ask Suicide-Screening Questions，核心问题包括
                        “是否希望自己已经死去”“是否觉得自己或家人会在你死后更好”“最近是否想过杀死自己”。
                        本页将这类表达归入“被动死亡愿望”与“主动自杀意念”证据域。
                      </p>
                      <a
                        href="https://www.nimh.nih.gov/research/research-conducted-at-nimh/asq-toolkit-materials/asq-tool/asq-information-sheet"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-medium text-[#2F6BFF] hover:underline"
                      >
                        NIMH ASQ Information Sheet
                      </a>
                    </div>
                    <div className="rounded-xl border border-[#EAF0F6] bg-white p-3">
                      <p className="font-semibold text-[#162033]">C-SSRS</p>
                      <p className="mt-1">
                        参考 Columbia-Suicide Severity Rating Scale 的分层逻辑，将
                        “希望死去”“实际想过自杀”“是否思考过方法”“是否形成计划或意图”
                        拆成不同严重程度的证据域，因此页面会单独标出“方法线索”等命中结果。
                      </p>
                      <a
                        href="https://www.cms.gov/files/document/cssrs-screen-version-instrument.pdf"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-medium text-[#2F6BFF] hover:underline"
                      >
                        C-SSRS Screen Version
                      </a>
                    </div>
                    <div className="rounded-xl border border-[#EAF0F6] bg-white p-3">
                      <p className="font-semibold text-[#162033]">NIMH Warning Signs</p>
                      <p className="mt-1">
                        参考 NIMH 官方自杀预警信号，将“想死”“负担感”“空虚、绝望、被困住”
                        “计划或研究死亡方式”“退缩、睡眠改变”等内容纳入“绝望/负担感”和“孤立/痛苦状态”证据域。
                      </p>
                      <a
                        href="https://www.nimh.nih.gov/health/publications/warning-signs-of-suicide"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-medium text-[#2F6BFF] hover:underline"
                      >
                        NIMH Warning Signs of Suicide
                      </a>
                    </div>
                    <p className="text-xs text-[#64748B]">
                      这些依据用于解释页面中的风险信号来源，服务于辅助筛查与研究展示，不等同临床诊断或正式量表结论。
                    </p>
                  </div>
                </details>
              </div>

              {/* 帖子内容 */}
              <div className="bg-gradient-to-r from-[#F7FAFD] to-white rounded-2xl p-5 border border-[#DCE7F5]">
                <h4 className="font-semibold text-sm text-[#162033] mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#2F6BFF]" />
                  帖子内容全文
                </h4>
                <p className="text-[#415168] leading-relaxed text-base bg-white rounded-xl p-4 border border-[#E2E8F0]">
                  {renderHighlightedContent(selectedPost.content, selectedPost.evidenceDomains)}
                </p>
                {selectedPost.evidenceDomains && selectedPost.evidenceDomains.length > 0 && (
                  <p className="mt-3 text-xs text-[#64748B]">
                    高亮内容表示当前帖子命中的风险证据短语，仅用于辅助筛查与解释，不等同临床诊断。
                  </p>
                )}
              </div>

              {/* 微表情序列 */}
              {selectedPost.microExpressions && selectedPost.microExpressions.length > 0 && (
                <div className="bg-gradient-to-r from-[#F7FAFD] to-white rounded-2xl p-5 border border-[#DCE7F5]">
                  <h4 className="font-semibold text-sm text-[#162033] mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#2F6BFF]" />
                    微表情序列
                  </h4>
                  <div className="text-2xl leading-relaxed tracking-wide">
                    {selectedPost.microExpressions.join(' ')}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[#64748B]">
                    <span>表情符号含义：</span>
                    <span>💀 自杀/死亡 | 🕳️ 空虚 | ⚠️ 警告 | 😭 悲伤</span>
                    <span>😔 失落 | 💪 坚强 | ✨ 希望 | 🌟 积极</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 无匹配帖子提示 */}
        {filteredPosts.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center shadow-sm">
            <p className="text-[#64748B]">暂无符合条件的帖子</p>
          </div>
        )}
      </div>
    </div>
  );
}
