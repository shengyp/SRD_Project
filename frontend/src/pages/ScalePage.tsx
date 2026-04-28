import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X,
  Brain, Shield, Activity, FileText,
  User, Search,
  Plus, Play, Eye, Clock, Target, Award, TrendingUp, Loader, TrendingDown
} from 'lucide-react';
import {
  fetchScaleTasks,
  createScaleTask,
  deleteScaleTask,
  fetchCSVArchives,
  type DemoArchiveRecord,
} from '../api';
import {
  SCALES_META,
  getScaleMeta,
  type ScaleMeta,
} from '../scales';
import { formatDateTime } from '../utils/dateFormat';

// ==================== 类型定义 ====================

interface UserProfile {
  id: string;
  userId: string;
  riskLevel: string;
  postCount: number;
  dataSource: string;
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
  reddit: 'Reddit',
};

// ==================== 统计卡片组件 ====================

function StatCard({ icon: Icon, label, value, colorClass }: { icon: any; label: string; value: number | string; colorClass: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#EADDD5] p-4 flex items-center gap-4 shadow-sm">
      <div className={`w-12 h-12 rounded-xl ${colorClass} flex items-center justify-center`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm text-[#8C7A6B]">{label}</span>
        <span className="text-2xl font-bold text-[#4A362C]">{value}</span>
      </div>
    </div>
  );
}

// ==================== 创建任务模态框 ====================

function CreateTaskModal({
  isOpen,
  onClose,
  onCreate,
  scales = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (task: CreateTaskInput) => void;
  scales?: ScaleMeta[];
}) {
  const [selectedDataSource, setSelectedDataSource] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedScale, setSelectedScale] = useState<ScaleMeta | null>(null);
  const [taskName, setTaskName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // 从 API 加载用户列表（从 CSV 数据集获取，心理档案导入的 reddit 用户）
  useEffect(() => {
    if (!isOpen) return;
    setUsersLoading(true);
    fetchCSVArchives({ datasetKey: selectedDataSource || 'reddit', page: 1, pageSize: 100 })
      .then(data => {
        const mapped: UserProfile[] = (data.archives || []).map((a: DemoArchiveRecord) => ({
          id: String(a.id),
          userId: a.userId,
          riskLevel: a.riskLevel?.toLowerCase() || 'low',
          postCount: a.postCount || 0,
          dataSource: a.dataSource || selectedDataSource || 'reddit',
        }));
        setUsers(mapped);
      })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [isOpen, selectedDataSource]);

  const filteredUsers = users.filter(user => {
    if (selectedDataSource && user.dataSource !== selectedDataSource) return false;
    if (searchKeyword && !user.userId.toLowerCase().includes(searchKeyword.toLowerCase())) return false;
    return true;
  });

  const handleCreate = () => {
    if (!selectedDataSource || !selectedUser || !selectedScale) return;
    const sourceLabel = DATA_SOURCE_LABELS[selectedDataSource] || selectedDataSource;
    const name = taskName || `${selectedScale.name}评估任务_${selectedUser.userId}`;
    onCreate({
      taskName: name,
      dataSource: selectedDataSource,
      dataSourceLabel: sourceLabel,
      userId: selectedUser.id,
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
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[700px] max-h-[85vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 模态框头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#EADDD5] bg-[#FAF6F3]">
          <h3 className="text-lg font-bold text-[#4A362C] flex items-center gap-2">
            <Plus className="w-5 h-5 text-[#C19A83]" />
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
            <label className="block text-sm font-medium text-[#5C4D43] mb-2">任务名称（选填）</label>
            <input
              type="text"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              placeholder="留空将自动生成"
              className="w-full px-4 py-2.5 border border-[#EADDD5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D7BFA6] focus:border-transparent"
            />
          </div>

          {/* 选择数据源 */}
          <div>
            <label className="block text-sm font-medium text-[#5C4D43] mb-2">步骤1：选择数据源</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(DATA_SOURCE_LABELS).map(([value, label]) => (
                <label key={value} className={`flex flex-col items-center gap-1 p-3 border-2 rounded-xl cursor-pointer transition-all ${
                  selectedDataSource === value ? 'border-[#C19A83] bg-[#FAF6F3]' : 'border-[#EADDD5] hover:border-[#D7BFA6]'
                }`}>
                  <input type="radio" name="datasource" value={value} checked={selectedDataSource === value}
                    onChange={(e) => { setSelectedDataSource(e.target.value); setSelectedUser(null); }} className="sr-only" />
                  <span className="text-lg">
                    {value === 'reddit' && '🌐'}
                  </span>
                  <span className="text-xs text-[#5C4D43]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 选择用户 */}
          <div>
            <label className="block text-sm font-medium text-[#5C4D43] mb-2">步骤2：选择评估用户</label>
            <div className="flex gap-3 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="搜索用户ID..." value={searchKeyword}
                  onChange={e => setSearchKeyword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-[#EADDD5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D7BFA6]" />
              </div>
            </div>
            <div className="border border-[#EADDD5] rounded-xl overflow-hidden max-h-36 overflow-y-auto">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-5 h-5 text-[#C19A83] animate-spin" />
                  <span className="ml-2 text-sm text-[#8C7A6B]">加载用户...</span>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-8 text-center text-sm text-[#A89F95]">
                  {users.length === 0 ? '暂无可用用户' : '无匹配用户'}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-[#F4EBE1] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#5C4D43] w-10">选择</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#5C4D43]">用户ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#5C4D43]">风险</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EADDD5]">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-[#FAF6F3]">
                        <td className="px-3 py-2">
                          <input type="radio" name="user" checked={selectedUser?.id === user.id}
                            onChange={() => setSelectedUser(user)} className="accent-[#C19A83]" />
                        </td>
                        <td className="px-3 py-2 text-sm text-[#5C4D43]">{user.userId}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 ${RISK_COLORS[user.riskLevel]?.bg || 'bg-gray-100'} ${RISK_COLORS[user.riskLevel]?.text || 'text-gray-700'} text-xs rounded-full`}>
                            {RISK_LABELS[user.riskLevel] || user.riskLevel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 选择量表 */}
          <div>
            <label className="block text-sm font-medium text-[#5C4D43] mb-2">步骤3：选择量表</label>
            <div className="grid grid-cols-2 gap-3">
              {scales.map((scale) => (
                <div key={scale.code} onClick={() => setSelectedScale(scale)}
                  className={`relative p-4 border-2 rounded-xl cursor-pointer transition-all ${
                    selectedScale?.code === scale.code ? 'border-[#C19A83] bg-[#FAF6F3]' : 'border-[#EADDD5] hover:border-[#D7BFA6]'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg ${scale.bgColor} flex items-center justify-center shrink-0`}>
                      {scale.category === 'suicide' && <Shield className="w-5 h-5 text-white" />}
                      {scale.category === 'depression' && <Brain className="w-5 h-5 text-white" />}
                      {scale.category === 'anxiety' && <Activity className="w-5 h-5 text-white" />}
                      {scale.category === 'hopelessness' && <TrendingDown className="w-5 h-5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-[#4A362C] text-sm">{scale.name}</h4>
                      <p className="text-xs text-[#8C7A6B] truncate">{scale.full_name}</p>
                      <p className="text-xs text-[#A89F95] mt-1">{scale.questionCount}题 · {scale.estimatedTime}</p>
                    </div>
                  </div>
                  {selectedScale?.code === scale.code && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-[#C19A83] rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 模态框底部 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#EADDD5] bg-[#FAF6F3]">
          <button onClick={onClose}
            className="px-5 py-2.5 border border-[#EADDD5] rounded-xl text-[#5C4D43] hover:bg-[#F4EBE1] transition-colors font-medium">
            取消
          </button>
          <button onClick={handleCreate} disabled={!selectedDataSource || !selectedUser || !selectedScale}
            className="px-5 py-2.5 bg-[#C19A83] hover:bg-[#A07D6B] disabled:bg-gray-300 text-white rounded-xl transition-colors font-medium disabled:cursor-not-allowed">
            创建任务
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 任务列表页 ====================

export default function ScalePage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ScaleTask[]>([]);
  const [scales] = useState<ScaleMeta[]>(SCALES_META);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);

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

  useEffect(() => { loadTasks(); }, []);

  // 计算统计数据
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  // 创建任务
  const handleCreateTask = async (taskData: CreateTaskInput) => {
    try {
      // 使用 scaleCode 作为 scaleId 传给后端（后端接受 scale_code 字符串格式）
      await createScaleTask({
        userHash: taskData.userName,
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
        <StatCard icon={Target} label="任务总数" value={stats.total} colorClass="bg-[#C19A83]" />
        <StatCard icon={Clock} label="待评估" value={stats.pending} colorClass="bg-gray-400" />
        <StatCard icon={TrendingUp} label="答题中" value={stats.inProgress} colorClass="bg-blue-500" />
        <StatCard icon={Award} label="已完成" value={stats.completed} colorClass="bg-green-500" />
      </div>

      {/* 任务列表区域 */}
      <div className="bg-white rounded-2xl border border-[#EADDD5] shadow-sm flex-1 flex flex-col min-h-0">
        {/* 列表头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#EADDD5]">
          <h3 className="text-base font-bold text-[#4A362C]">量表评估任务列表</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#C19A83] hover:bg-[#A07D6B] text-white rounded-xl transition-colors font-medium text-sm">
            <Plus className="w-4 h-4" />
            创建任务
          </button>
        </div>

        {/* 表格区域 */}
        <div className="flex-1 overflow-auto">
          {tasksLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader className="w-8 h-8 text-[#C19A83] animate-spin mb-4" />
              <p className="text-[#8C7A6B]">加载中...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="w-12 h-12 text-[#D7BFA6] mb-4" />
              <p className="text-[#8C7A6B]">暂无评估任务</p>
              <p className="text-sm text-[#A89F95] mt-1">点击上方「创建任务」按钮开始您的第一次量表评估</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gradient-to-r from-[#F9F5F2] to-[#FDF9F6] sticky top-0">
                <tr>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">任务名称</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">数据来源</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">评估用户</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">量表类型</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">状态</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">进度</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">创建时间</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold text-[#5C4D43]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EADDD5]">
                {tasks.map((task) => {
                  const scaleColor = getScaleColor(task.scaleCode);
                  const statusStyle = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
                  return (
                    <tr key={task.id} className="hover:bg-[#FAF6F3] transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-[#4A362C]">{task.taskName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#5C4D43]">{task.dataSourceLabel || DATA_SOURCE_LABELS[task.dataSource as keyof typeof DATA_SOURCE_LABELS] || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-[#A89F95]" />
                          <span className="text-sm text-[#5C4D43]">{task.userName}</span>
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
                          <div className="w-20 h-1.5 bg-[#EADDD5] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              task.status === 'completed' ? 'bg-green-500' :
                              task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
                            }`} style={{ width: `${task.progress}%` }}></div>
                          </div>
                          <span className="text-xs text-[#8C7A6B]">{task.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#8C7A6B]">{formatTime(task.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStartTask(task.id)}
                            disabled={task.status === 'completed'}
                            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 disabled:from-gray-100 disabled:to-gray-100 text-green-600 disabled:text-gray-400 disabled:cursor-not-allowed rounded-xl transition-all text-sm font-medium border border-green-200 disabled:border-gray-200">
                            <Play className="w-4 h-4" />
                            {task.status === 'in_progress' ? '继续' : '开始'}
                          </button>
                          <button
                            onClick={() => handleViewResult(task.id)}
                            disabled={task.status !== 'completed'}
                            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 disabled:from-gray-100 disabled:to-gray-100 text-blue-600 disabled:text-gray-400 disabled:cursor-not-allowed rounded-xl transition-all text-sm font-medium border border-blue-200 disabled:border-gray-200">
                            <Eye className="w-4 h-4" />
                            查看
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-600 rounded-xl transition-all text-sm font-medium border border-red-200">
                            <X className="w-4 h-4" />
                            删除
                          </button>
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
      />
    </div>
  );
}
