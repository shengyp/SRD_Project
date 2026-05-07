import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X,
  Brain, Shield, Activity, FileText,
  User, Search, MoonStar,
  Plus, Play, Eye, Clock, Target, Award, TrendingUp, Loader, TrendingDown
} from 'lucide-react';
import PaperStatCard from '../components/PaperStatCard';
import {
  fetchScaleTasks,
  createScaleTask,
  deleteScaleTask,
  fetchDatasets,
  fetchArchiveUsers,
  type DatasetProfile,
} from '../api';
import {
  getAllScalesMeta,
  getScaleMeta,
  loadScalesData,
  type ScaleMeta,
} from '../scales';
import { formatDateTime } from '../utils/dateFormat';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

// ==================== 类型定义 ====================

interface UserProfile {
  id: string | number;
  userId: string;
  riskLevel: string;
  postCount: number;
  dataSource: string;
  importTime?: string;
}

interface ScaleTask {
  id: string;
  taskName: string;
  dataSource?: string;
  dataSourceLabel?: string;
  userId: string;
  userName: string;
  scaleId: string;
  scaleCode: string;
  scaleName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired';
  progress: number;
  totalQuestions: number;
  answeredQuestions: number;
  totalScore?: number;
  threshold?: number;
  riskLevel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  answers?: number[];
}

interface CreateTaskInput {
  taskName: string;
  dataSource: string;
  dataSourceLabel: string;
  userId: string;
  userName: string;
  scaleCode: string;
  scaleName: string;
  totalQuestions: number;
  answeredQuestions: number;
}

// ==================== 任务风险色彩与标签配置 ====================

const RISK_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-700' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待评估',
  in_progress: '答题中',
  completed: '已完成',
};

const DATA_SOURCE_LABELS: Record<string, string> = {
  reddit: 'Reddit系列',
  bigdata: 'Bigdata系列',
  sigir: 'SIGIR系列',
  weibo: 'Weibo系列',
};

const SCALE_TIER_ORDER = ['core_default', 'supplemental_profile', 'specialized_risk', 'research_backup'] as const;
const SCALE_TIER_LABELS: Record<(typeof SCALE_TIER_ORDER)[number], string> = {
  core_default: '核心默认量表',
  supplemental_profile: '补充画像量表',
  specialized_risk: '专项风险量表',
  research_backup: '研究/备用量表',
};

// ==================== 创建任务模态框 ====================

function CreateTaskModal({
  isOpen,
  onClose,
  onCreate,
  scales = [],
  dataSourceOptions,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (task: CreateTaskInput) => void;
  scales?: ScaleMeta[];
  dataSourceOptions: { value: string; label: string }[];
}) {
  const [selectedDataSource, setSelectedDataSource] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedScale, setSelectedScale] = useState<ScaleMeta | null>(null);
  const [taskName, setTaskName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const groupedScales = useMemo(() => {
    const buckets = new Map<string, ScaleMeta[]>();
    scales.forEach((scale) => {
      const tier = scale.systemClassification.tier || 'research_backup';
      const list = buckets.get(tier) || [];
      list.push(scale);
      buckets.set(tier, list);
    });
    return SCALE_TIER_ORDER
      .map((tier) => ({
        tier,
        label: SCALE_TIER_LABELS[tier],
        scales: buckets.get(tier) || [],
      }))
      .filter((group) => group.scales.length > 0);
  }, [scales]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      setUsersPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, searchKeyword]);

  useEffect(() => {
    if (!isOpen || !selectedDataSource) {
      setUsers([]);
      setUsersTotal(0);
      setUsersTotalPages(0);
      setUsersLoading(false);
      return;
    }
    let cancelled = false;

    const loadUsers = async () => {
      setUsersLoading(true);
      try {
        const result = await fetchArchiveUsers({
          dataset: selectedDataSource,
          keyword: searchKeyword.trim() || undefined,
          page: usersPage,
          pageSize: 20,
        });
        if (!cancelled) {
          setUsers(result.users.map((user) => ({
            id: user.archiveId,
            userId: user.userId,
            riskLevel: user.riskLevel?.toLowerCase() || 'low',
            postCount: user.postCount || 0,
            dataSource: user.datasetSource || selectedDataSource,
            importTime: user.importTime,
          })));
          setUsersTotal(result.total || 0);
          setUsersTotalPages(result.totalPages || 0);
        }
      } catch {
        if (!cancelled) {
          setUsers([]);
          setUsersTotal(0);
          setUsersTotalPages(0);
        }
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };

    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedDataSource, searchKeyword, usersPage]);

  const handleCreate = () => {
    if (!selectedDataSource || !selectedUser || !selectedScale) return;
    const sourceLabel = DATA_SOURCE_LABELS[selectedDataSource] || selectedDataSource;
    const name = taskName || `${selectedScale.name}评估任务_${selectedUser.userId}`;
    onCreate({
      taskName: name,
      dataSource: selectedDataSource,
      dataSourceLabel: sourceLabel,
      userId: String(selectedUser.id),
      userName: selectedUser.userId,
      scaleCode: selectedScale.code,
      scaleName: selectedScale.name,
      totalQuestions: selectedScale.questionCount,
      answeredQuestions: 0,
    });
    onClose();
    setSelectedDataSource('');
    setSelectedUser(null);
    setSelectedScale(null);
    setTaskName('');
    setSearchKeyword('');
    setUsersPage(1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[700px] max-h-[85vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 模态框头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-[#F7FAFD]">
          <h3 className="text-lg font-bold text-[#162033] flex items-center gap-2">
            <Plus className="w-5 h-5 text-[#2F6BFF]" />
            创建量表评估任务
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 模态框内容 */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-140px)] space-y-5">
          {/* 任务名称 */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-2">任务名称（选填）</label>
            <input
              type="text"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              placeholder="留空将自动生成"
              className="w-full px-4 py-2.5 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
            />
          </div>

          {/* 选择数据源 */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-2">步骤1：选择数据源</label>
            <div className="grid grid-cols-4 gap-2">
              {dataSourceOptions.map(({ value, label }) => (
                <label key={value} className={`flex flex-col items-center gap-1 p-3 border-2 rounded-xl cursor-pointer transition-all ${
                  selectedDataSource === value ? 'border-[#2F6BFF] bg-[#F3F8FF]' : 'border-[#E2E8F0] hover:border-[#8FB4FF]'
                }`}>
                  <input type="radio" name="datasource" value={value} checked={selectedDataSource === value}
                    onChange={(e) => {
                      setSelectedDataSource(e.target.value);
                      setSelectedUser(null);
                      setSearchKeyword('');
                      setUsersPage(1);
                    }} className="sr-only" />
                  <span className="text-lg">
                    {value === 'reddit' && '🌐'}
                    {value === 'bigdata' && '📚'}
                    {value === 'sigir' && '🧪'}
                    {value === 'weibo' && '🪶'}
                  </span>
                  <span className="text-xs text-[#415168]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 选择用户 */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-2">步骤2：选择评估用户</label>
            <div className="flex gap-3 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="搜索用户ID..." value={searchKeyword}
                  disabled={!selectedDataSource}
                  onChange={e => setSearchKeyword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
            </div>
            <div className="mb-2 text-xs text-[#94A3B8]">
              {!selectedDataSource
                ? '请先选择数据源'
                : `当前数据系列共 ${usersTotal} 位用户，当前第 ${usersPage}/${Math.max(usersTotalPages, 1)} 页`}
            </div>
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden max-h-56 overflow-y-auto">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-5 h-5 text-[#2F6BFF] animate-spin" />
                  <span className="ml-2 text-sm text-[#64748B]">加载用户...</span>
                </div>
              ) : users.length === 0 ? (
                <div className="py-8 text-center text-sm text-[#94A3B8]">
                  {!selectedDataSource ? '请选择数据源后再搜索用户' : searchKeyword ? '无匹配用户' : '暂无可用用户'}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-[#F7FAFD] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#415168] w-10">选择</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#415168]">用户ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#415168]">风险</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#415168]">贴文数</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-[#F7FAFD]">
                        <td className="px-3 py-2">
                          <input type="radio" name="user" checked={selectedUser?.id === user.id}
                            onChange={() => setSelectedUser(user)} className="accent-[#2F6BFF]" />
                        </td>
                        <td className="px-3 py-2 text-sm text-[#415168]">{user.userId}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 ${RISK_COLORS[user.riskLevel]?.bg || 'bg-gray-100'} ${RISK_COLORS[user.riskLevel]?.text || 'text-gray-700'} text-xs rounded-full`}>
                            {RISK_LABELS[user.riskLevel] || user.riskLevel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-[#64748B]">{user.postCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selectedDataSource && (
              <div className="mt-3 flex items-center justify-between text-xs text-[#64748B]">
                <span>每页 20 位用户</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={usersPage <= 1 || usersLoading}
                    onClick={() => setUsersPage((page) => Math.max(1, page - 1))}
                    className="px-3 py-1 rounded-lg border border-[#E2E8F0] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F7FAFD]"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={usersLoading || usersPage >= Math.max(usersTotalPages, 1)}
                    onClick={() => setUsersPage((page) => page + 1)}
                    className="px-3 py-1 rounded-lg border border-[#E2E8F0] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F7FAFD]"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 选择量表 */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-2">步骤3：选择量表</label>
            <div className="space-y-4">
              {groupedScales.map((group) => (
                <div key={group.tier} className="rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-[#162033]">{group.label}</h4>
                      <p className="text-xs text-[#94A3B8]">
                        {group.tier === 'core_default' && '推荐优先使用的标准筛查组合'}
                        {group.tier === 'supplemental_profile' && '用于补充情绪多维画像，不单独作为危机判定'}
                        {group.tier === 'specialized_risk' && '用于专项自杀风险复核与危机识别'}
                        {group.tier === 'research_backup' && '用于研究、对照或备用，不建议默认首选'}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#5B78C7] border border-[#D8E5FF]">
                      {group.scales.length} 个量表
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {group.scales.map((scale) => (
                      <div key={scale.code} onClick={() => setSelectedScale(scale)}
                        className={`relative p-4 border-2 rounded-xl cursor-pointer transition-all ${
                          selectedScale?.code === scale.code ? 'border-[#2F6BFF] bg-[#F3F8FF]' : 'border-[#E2E8F0] bg-white hover:border-[#8FB4FF]'
                        }`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg ${scale.bgColor} flex items-center justify-center shrink-0`}>
                            {scale.category === 'suicide' && <Shield className="w-5 h-5 text-white" />}
                            {scale.category === 'depression' && <Brain className="w-5 h-5 text-white" />}
                            {scale.category === 'anxiety' && <Activity className="w-5 h-5 text-white" />}
                            {scale.category === 'hopelessness' && <TrendingDown className="w-5 h-5 text-white" />}
                            {scale.category === 'sleep' && <MoonStar className="w-5 h-5 text-white" />}
                            {!['suicide', 'depression', 'anxiety', 'hopelessness', 'sleep'].includes(scale.category) && <Brain className="w-5 h-5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-[#162033] text-sm">{scale.name}</h4>
                              <span className="rounded-full bg-[#F3F6FB] px-2 py-0.5 text-[11px] text-[#5B6780]">
                                {scale.systemClassification.clinical_role === 'screening' && '筛查'}
                                {scale.systemClassification.clinical_role === 'profile' && '画像'}
                                {scale.systemClassification.clinical_role === 'crisis' && '专项风险'}
                                {scale.systemClassification.clinical_role === 'research' && '研究/备用'}
                              </span>
                            </div>
                            <p className="text-xs text-[#64748B] truncate">{scale.full_name}</p>
                            <p className="text-xs text-[#94A3B8] mt-1">{scale.questionCount}题 · {scale.estimatedTime}</p>
                          </div>
                        </div>
                        {selectedScale?.code === scale.code && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-[#2F6BFF] rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 模态框底部 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0] bg-[#F7FAFD]">
          <ActionCapsuleButton onClick={onClose} variant="neutral" size="lg">
            取消
          </ActionCapsuleButton>
          <ActionCapsuleButton onClick={handleCreate} disabled={!selectedDataSource || !selectedUser || !selectedScale} variant="solid" size="lg">
            创建任务
          </ActionCapsuleButton>
        </div>
      </div>
    </div>
  );
}

// ==================== 任务列表页 ====================

export default function ScalePage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ScaleTask[]>([]);
  const [scales, setScales] = useState<ScaleMeta[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [dataSourceOptions, setDataSourceOptions] = useState<{ value: string; label: string }[]>(
    Object.entries(DATA_SOURCE_LABELS).map(([value, label]) => ({ value, label }))
  );

  // 加载任务列表
  const loadTasks = () => {
    setTasksLoading(true);
    fetchScaleTasks({ limit: 100 })
      .then(data => {
        const mapped: ScaleTask[] = (data.tasks || []).map((t) => ({
          id: String(t.id),
          taskName: t.taskName || `${t.scaleName}评估任务`,
          dataSource: t.dataSource || t.scaleCategory || 'reddit',
          dataSourceLabel: t.dataSourceLabel || DATA_SOURCE_LABELS[t.dataSource as keyof typeof DATA_SOURCE_LABELS] || 'Reddit',
          userId: String(t.userHash || t.userId || ''),
          userName: t.userAlias || t.userHash || '未知用户',
          scaleId: String(t.scaleId || ''),
          scaleCode: t.scaleCode || '',
          scaleName: t.scaleName || t.scaleCode || '未知量表',
          status: (t.status || 'pending') as ScaleTask['status'],
          progress: t.progress || 0,
          totalQuestions: t.totalQuestions || 0,
          answeredQuestions: t.answeredQuestions || 0,
          totalScore: t.totalScore,
          threshold: (t as any).threshold,
          riskLevel: t.riskLevel,
          createdAt: t.createdAt || new Date().toISOString(),
          startedAt: t.startedAt,
          completedAt: t.completedAt,
        }));
        setTasks(mapped);
      })
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false));
  };

  useEffect(() => {
    loadScalesData()
      .then(() => setScales(getAllScalesMeta()))
      .catch((err) => console.error('加载量表定义失败:', err));
    loadTasks();
  }, []);

  useEffect(() => {
    fetchDatasets()
      .then((datasets: DatasetProfile[]) => {
        if (datasets?.length) {
          setDataSourceOptions(datasets.map((dataset) => ({
            value: dataset.datasetKey,
            label: dataset.displayName,
          })));
        }
      })
      .catch(() => {
        // 使用默认值回退
      });
  }, []);

  // 计算统计数据
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  const statCards = [
    {
      label: '任务总数',
      value: stats.total,
      note: '当前量表任务池中的全部评估任务数量，覆盖待评估、进行中与已完成状态。',
      icon: Target,
      tone: 'blue' as const,
    },
    {
      label: '待评估',
      value: stats.pending,
      note: '尚未开始作答或等待进入评估流程的量表任务数量。',
      icon: Clock,
      tone: 'slate' as const,
    },
    {
      label: '答题中',
      value: stats.inProgress,
      note: '当前处于量表填写过程中的任务数量，可继续进入问卷作答。',
      icon: TrendingUp,
      tone: 'cyan' as const,
    },
    {
      label: '已完成',
      value: stats.completed,
      note: '已经完成量表评分与结果输出的任务数量，可直接查看评估结果。',
      icon: Award,
      tone: 'green' as const,
    },
  ];

  // 创建任务
  const handleCreateTask = async (taskData: CreateTaskInput) => {
    try {
      // 使用 scaleCode 作为 scaleId 传给后端（后端接受 scale_code 字符串格式）
      await createScaleTask({
        taskName: taskData.taskName,
        userHash: taskData.userName,
        archiveId: Number(taskData.userId),
        scaleId: taskData.scaleCode,
        dataSource: taskData.dataSource,
      });
      loadTasks();
    } catch (err) {
      console.error('创建任务失败:', err);
    }
  };

  // 开始答题
  const handleStartTask = (taskId: string) => {
    navigate(`/scale/answer/${taskId}`);
  };

  // 查看结果
  const handleViewResult = (taskId: string) => {
    navigate(`/scale/result/${taskId}`);
  };

  // 删除任务
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('确定要删除该任务吗？')) return;
    try {
      await deleteScaleTask(Number(taskId));
      loadTasks();
    } catch (err) {
      console.error('删除任务失败:', err);
    }
  };

  // 格式化时间
  const formatTime = (isoString: string) => {
    return formatDateTime(isoString);
  };

  // 获取量表颜色
  const getScaleColor = (scaleCode: string) => {
    const scale = getScaleMeta(scaleCode);
    if (!scale) return { color: 'bg-gray-100 text-gray-600', bgColor: 'bg-gray-400' };
    return { color: scale.color, bgColor: scale.bgColor };
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full animate-fade-in space-y-5">
      {/* 统计卡片区域 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <PaperStatCard
            key={card.label}
            label={card.label}
            value={card.value}
            note={card.note}
            icon={card.icon}
            tone={card.tone}
          />
        ))}
      </div>

      {/* 任务列表区域 */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm flex-1 flex flex-col min-h-0">
        {/* 列表头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h3 className="text-base font-bold text-[#162033]">量表评估任务列表</h3>
          <ActionCapsuleButton
            onClick={() => setShowCreateModal(true)}
            variant="solid"
            size="lg"
            icon={<Plus className="w-4 h-4" />}
          >
            创建任务
          </ActionCapsuleButton>
        </div>

        {/* 表格区域 */}
        <div className="flex-1 overflow-auto">
          {tasksLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader className="w-8 h-8 text-[#2F6BFF] animate-spin mb-4" />
              <p className="text-[#64748B]">加载中...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="w-12 h-12 text-[#BFD3F2] mb-4" />
              <p className="text-[#64748B]">暂无评估任务</p>
              <p className="text-sm text-[#94A3B8] mt-1">点击上方「创建任务」按钮开始您的第一次量表评估</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gradient-to-r from-[#F7FAFD] to-[#F3F8FF] sticky top-0">
                <tr>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">任务名称</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">数据来源</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">评估用户</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">量表类型</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">状态</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">进度</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">创建时间</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#415168]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {tasks.map((task) => {
                  const scaleColor = getScaleColor(task.scaleCode);
                  const statusStyle = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
                  return (
                    <tr key={task.id} className="hover:bg-[#F7FAFD] transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-[#162033]">{task.taskName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#415168]">{task.dataSourceLabel || DATA_SOURCE_LABELS[task.dataSource as keyof typeof DATA_SOURCE_LABELS] || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-[#94A3B8]" />
                          <span className="text-sm text-[#415168]">{task.userName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${scaleColor.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${scaleColor.bgColor}`}></span>
                          {task.scaleName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot} ${task.status === 'in_progress' ? 'animate-pulse' : ''}`}></span>
                          {STATUS_LABELS[task.status] || task.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              task.status === 'completed' ? 'bg-green-500' :
                              task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
                            }`} style={{ width: `${task.progress}%` }}></div>
                          </div>
                          <span className="text-xs text-[#64748B]">{task.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#64748B]">{formatTime(task.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <ActionCapsuleButton
                            onClick={() => handleStartTask(task.id)}
                            disabled={task.status === 'completed'}
                            tone="green"
                            tableAction
                            icon={<Play className="w-4 h-4" />}
                          >
                            {task.status === 'in_progress' ? '继续' : '开始'}
                          </ActionCapsuleButton>
                          <ActionCapsuleButton
                            onClick={() => handleViewResult(task.id)}
                            disabled={task.status !== 'completed'}
                            tone="blue"
                            tableAction
                            icon={<Eye className="w-4 h-4" />}
                          >
                            查看
                          </ActionCapsuleButton>
                          <ActionCapsuleButton
                            onClick={() => handleDeleteTask(task.id)}
                            tone="red"
                            tableAction
                            icon={<X className="w-4 h-4" />}
                          >
                            删除
                          </ActionCapsuleButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 创建任务模态框 */}
      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateTask}
        scales={scales}
        dataSourceOptions={dataSourceOptions}
      />
    </div>
  );
}
