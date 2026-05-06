import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import {
  Clock, Filter, Search, FileText,
  Activity, MessageSquare, ArrowLeft,
  FilterX, Info, Star
} from 'lucide-react';
import { fetchCSVPUserPosts, fetchCSVUserKeywords, fetchDatasets, DemoPostRecord, DatasetProfile } from '../api';
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
  riskOverview?: '高风险' | '中风险' | '低风险';
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
    if (archiveId) {
      // 从 sessionStorage 获取选中的档案信息
      const savedArchive = sessionStorage.getItem('selectedArchive');
      let userHash: string | null = null;
      let datasetKey: string | null = null;
      
      if (savedArchive) {
        try {
          const archive = JSON.parse(savedArchive) as ArchiveRecord;
          // 兼容不同的字段名：dataSource 或 datasetSource
          const ds = archive.dataSource || (archive as any).datasetSource || 'reddit';
          const uid = archive.userId || archive.id;
          // 如果有 userId，设置 selectedArchive
          if (uid && uid === archiveId) {
            setSelectedArchive(archive);
            userHash = uid;
            datasetKey = ds;
          }
        } catch (e) {
          console.error('Failed to parse saved archive:', e);
        }
      }

      // 如果没有从 sessionStorage 获取到 userHash，尝试从 URL params
      if (!userHash) {
        userHash = params.archiveId || null;
      }

      // 如果没有从 sessionStorage 获取到数据集，从 URL 参数中获取
      if (!datasetKey) {
        datasetKey = new URLSearchParams(window.location.search).get('dataset') || 'reddit';
      }

      // 至少设置一个默认的 selectedArchive，确保页面不会卡在加载状态
      setSelectedArchive({
        id: userHash,
        userId: userHash,
        userHash: userHash,
        dataSource: datasetKey,
        gender: '',
        age: 0,
        riskLevel: 'unknown',
        recordCount: 0,
      } as ArchiveRecord);
      
      if (userHash) {
        // 一次性获取足够多的帖子数据（50条），前端负责分页显示
        fetchCSVPUserPosts({ datasetKey, userHash, pageSize: 100 })
          .then((res) => {
            // 转换 DemoPostRecord 到 PostRecord
            const loadedPosts: PostRecord[] = (res.posts || []).map((p: DemoPostRecord) => ({
              id: p.id,
              userId: p.userId,
              postIndex: p.postIndex,
              content: p.content,
              // 使用后端计算的重要性分数，如果后端未提供则使用风险值作为参考
              importanceScore: p.importanceScore ?? (p.riskScore ?? 0.5),
              riskLevel: p.riskLevel || 'medium',
              riskScore: p.riskScore ?? 0.5,
              suicideRisk: p.suicideRisk,
              timestamp: p.timestamp || undefined,
              hasTimestamp: p.hasTimestamp ?? Boolean(p.timestamp),
              status: (p.status as 'pending' | 'accepted' | 'rejected') || 'accepted',
              // 微表情序列：直接从 API 传递原始字符串
              microExpressions: p.emojiSequence ? [p.emojiSequence] : undefined,
            }));
            setPosts(loadedPosts);
            // 重置可见帖子数量为默认的15条
            setVisiblePostCount(15);
            // 默认选中 Top 1（按重要性分数排序）
            const sorted = [...loadedPosts].sort((a, b) => b.importanceScore - a.importanceScore);
            setSelectedPost(sorted[0] || null);
          })
          .catch((err) => {
            console.error('Failed to load posts:', err);
            setPosts([]);
          });
      }
    }
  }, [archiveId, params.archiveId]);

  // 高频词汇（从后端 API 实时获取）
  const [frequentWords, setFrequentWords] = useState<string[]>([]);
  useEffect(() => {
    if (!params.archiveId) return;
    const savedArchive = sessionStorage.getItem('selectedArchive');
    // 从 sessionStorage 获取数据源，默认为 reddit
    let datasetKeyForKeywords = 'reddit';
    if (savedArchive) {
      try {
        const archive = JSON.parse(savedArchive);
        datasetKeyForKeywords = archive.dataSource || (archive as any).datasetSource || 'reddit';
      } catch (e) {
        console.warn('Failed to parse saved archive for datasetKey:', e);
      }
    }
    fetchCSVUserKeywords({ datasetKey: datasetKeyForKeywords, userHash: params.archiveId, topN: 8 })
      .then((res) => setFrequentWords(res.keywords.map((k) => k.word)))
      .catch(() => setFrequentWords([]));
  }, [params.archiveId]);

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

// 风险颜色
  const riskKey = selectedArchive?.riskOverview === '高风险' ? 'high' : selectedArchive?.riskOverview === '中风险' ? 'medium' : 'low';

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
              {selectedArchive.riskOverview}
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
            <span>近N天内频繁词汇：</span>
          </div>
          {frequentWords.map((word, i) => (
            <span key={i} className="px-3 py-1 bg-white border border-[#DCE7F5] text-[#2F6BFF] text-sm rounded-full font-medium hover:bg-blue-50 transition-colors cursor-default">
              {word}
            </span>
          ))}
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
            <span>• 悬停柱子：显示重要性分数、风险等级、摘要</span>
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
                    hasUsableTimestamp(p) ? formatTimestampLabel(p.timestamp) : `#${p.postIndex}`
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
                      <div><b>${hasUsableTimestamp(p) ? '时间戳' : '帖子序号'}</b>: ${hasUsableTimestamp(p) ? (p.timestamp || '-') : `#${p.postIndex}`}</div>
                      <div><b>重要性分数</b>: ${p.importanceScore.toFixed(4)}</div>
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
                    <p className="font-semibold text-[#162033] text-sm">#{selectedPost.postIndex}</p>
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
              </div>

              {/* 帖子内容 */}
              <div className="bg-gradient-to-r from-[#F7FAFD] to-white rounded-2xl p-5 border border-[#DCE7F5]">
                <h4 className="font-semibold text-sm text-[#162033] mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#2F6BFF]" />
                  帖子内容全文
                </h4>
                <p className="text-[#415168] leading-relaxed text-base bg-white rounded-xl p-4 border border-[#E2E8F0]">
                  {selectedPost.content}
                </p>
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
