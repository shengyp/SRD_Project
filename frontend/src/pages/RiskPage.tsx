import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, Eye, X, Check, AlertTriangle,
  FileText, ArrowLeft, Clock, Play,
  CheckCircle, Loader, Server, Trash2,
  Bot, Brain, Shield, Activity, Users, TrendingUp,
  Cloud, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  fetchDatasets,
  fetchApiModelsForRiskPage,
  fetchLlmModelsForRiskPage,
  fetchPromptTemplatesForRiskPage,
  fetchDetectionModelsForRiskPage,
  fetchEmoccTasks,
  deleteEmoccTask,
  createEmoccDetectionTask,
  executeEmoccTask,
  fetchDetectionTasks,
  deleteDetectionTask,
  executeDetectionTask,
  fetchRiskReport,
} from '../api';
import type {
  RiskPageApiModel,
  RiskPageLlmModel,
  RiskPagePromptTemplate,
  RiskPageLocalModel,
  EmoccTaskResult,
} from '../api';
import PaperStatCard from '../components/PaperStatCard';

// ==================== 类型定义 ====================

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface RiskTask {
  id: string;
  taskCode?: string;
  taskName: string;
  taskDescription?: string;
  taskMode: 'api' | 'local_llm' | 'emocc' | 'fealearner';
  userHash: string;
  dataSource: string;
  postCount: number;
  modelId?: number;
  modelName?: string;
  status: TaskStatus;
  progress: number;
  resultSummary?: RiskResultSummary;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  processingTimeMs?: number;
}

interface RiskResultSummary {
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  confidence: number;
  summary: string;
  emoccModelResult?: {
    riskLevel: string;
    riskScore: number;
    riskClass: number;
    confidence: number;
    postCount: number;
    classProbs: number[];
    postAttentionScores?: { 
      post_index?: number;
      postIndex?: number; 
      attention_score?: number;
      attentionScore?: number; 
      text_preview?: string;
      textPreview?: string; 
      emoji_count?: number;
      emojiCount?: number;
    }[];
    modelType: string;
  };
  symptomDescription?: string;
  emotionalAnalysis?: string;
  riskInterpretation?: string;
  keyHighlight?: string;
  riskFactors?: string[];
  protectiveFactors?: string[];
  professionalAdvice?: string;
  interventionSuggestion?: string;
  followUpSuggestion?: string;
}

// MD5 哈希函数（用于生成与后端一致的用户哈希）
function md5(text: string): string {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5blks(s: string): number[] {
    const nblk = ((s.length + 8) >> 6) + 1;
    const blks: number[] = [];
    for (let i = 0; i < nblk * 16; i++) {
      blks[i] = 0;
    }
    for (let i = 0; i < s.length; i++) {
      const j = i >> 2;
      blks[j] |= s.charCodeAt(i) << ((i % 4) * 8);
    }
    blks[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    blks[nblk * 16 - 2] = s.length * 8;
    return blks;
  }
  const x = md5blks(text);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const olda = a, oldb = b, oldc = c, oldd = d;
    a = md5ff(a, b, c, d, x[i], 7, -680876936); d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, x[i + 2], 17, 606105819); b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, x[i + 4], 7, -176418897); d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341); b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416); d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, x[i + 10], 17, -42063); b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682); d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290); b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = md5gg(a, b, c, d, x[i + 1], 5, -165796510); d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, x[i + 11], 14, 643717713); b = md5gg(b, c, d, a, x[i], 20, -373897302);
    a = md5gg(a, b, c, d, x[i + 5], 5, -701558691); d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, x[i + 15], 14, -660478335); b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, x[i + 9], 5, 568446438); d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, x[i + 3], 14, -187363961); b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467); d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473); b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = md5hh(a, b, c, d, x[i + 5], 4, -378558); d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562); b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060); d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, x[i + 7], 16, -155497632); b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, x[i + 13], 4, 681279174); d = md5hh(d, a, b, c, x[i + 0], 11, -358537222);
    c = md5hh(c, d, a, b, x[i + 3], 16, -722521979); b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, x[i + 9], 4, -640364487); d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, x[i + 15], 16, 530742520); b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = md5ii(a, b, c, d, x[i], 6, -198630844); d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905); b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571); d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, x[i + 10], 15, -1051523); b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359); d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380); b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, x[i + 4], 6, -145523070); d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, x[i + 2], 15, 718787259); b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
  }
  const hex = (n: number): string => {
    const hexx = '0123456789abcdef';
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += hexx.charAt((n >> (j * 8 + 4)) & 0x0f) + hexx.charAt((n >> (j * 8)) & 0x0f);
    }
    return s;
  };
  return (hex(a) + hex(b) + hex(c) + hex(d)).toLowerCase();
}

// ==================== 常量 ====================

const RISK_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  low:    { bg: 'bg-green-50',  text: 'text-green-700', border: 'border-green-200', badge: 'bg-green-500' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', badge: 'bg-yellow-500' },
  high:   { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    badge: 'bg-red-500' },
};

const RISK_LABELS: Record<string, string> = {
  'no-risk': '无风险', 'very-low': '极低风险', low: '低风险', medium: '中风险', high: '高风险',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending:   { label: '待执行', bg: 'bg-gray-100', text: 'text-gray-600' },
  running:   { label: '执行中', bg: 'bg-blue-100',  text: 'text-blue-600'  },
  completed: { label: '已完成', bg: 'bg-green-100', text: 'text-green-600' },
  failed:    { label: '失败',   bg: 'bg-red-100',  text: 'text-red-600'  },
};

const MODEL_CATEGORIES = [
  { value: 'api',       label: 'API 模型',   icon: Cloud  },
  { value: 'local_llm', label: '本地 LLM',   icon: Bot    },
  { value: 'emocc',     label: '检测模型',    icon: Brain  },
];

// ==================== 创建任务弹窗 ====================

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (task: RiskTask) => void;
  availableUsers: { id: string; userHash: string; displayName: string; riskLevel: string; postCount: number }[];
  dataSources: { value: string; label: string }[];
}

function CreateTaskModal({ isOpen, onClose, onCreated, availableUsers, dataSources }: CreateTaskModalProps) {
  const [modelCategory, setModelCategory] = useState<'api' | 'local_llm' | 'emocc'>('api');
  const [taskName, setTaskName] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedUser, setSelectedUser] = useState<{ id: string; userHash: string; displayName: string; riskLevel: string; postCount: number } | null>(null);
  const [selectedApiModel, setSelectedApiModel] = useState<RiskPageApiModel | null>(null);
  const [selectedLlmModel, setSelectedLlmModel] = useState<RiskPageLlmModel | null>(null);
  const [selectedDetectionModel, setSelectedDetectionModel] = useState<RiskPageLocalModel | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<RiskPagePromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef<AbortController | null>(null); // 使用 AbortController 防止重复请求
  const [apiModels, setApiModels] = useState<RiskPageApiModel[]>([]);
  const [llmModels, setLlmModels] = useState<RiskPageLlmModel[]>([]);
  const [detectionModels, setDetectionModels] = useState<RiskPageLocalModel[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<RiskPagePromptTemplate[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    Promise.all([
      fetchApiModelsForRiskPage(),
      fetchLlmModelsForRiskPage(),
      fetchDetectionModelsForRiskPage(),
      fetchPromptTemplatesForRiskPage(),
    ]).then(([api, llm, detection, templates]) => {
      setApiModels(api);
      setLlmModels(llm);
      // 检测模型：包含 Emocc (emoji) 和 FeaLearner (fealearner) 两种类型
      setDetectionModels(detection);
      setPromptTemplates(templates);
      // Auto-select first available detection model
      if (detection.length > 0 && !selectedDetectionModel) {
        setSelectedDetectionModel(detection[0]);
      }
    });
  }, [isOpen]);

  const handleCreate = async () => {
    if (!selectedUser || !selectedSource) return;
    // 取消之前的请求
    if (creatingRef.current) {
      creatingRef.current.abort();
    }
    const controller = new AbortController();
    creatingRef.current = controller;
    setCreating(true);
    try {
      let newTask: RiskTask;

      if (modelCategory === 'emocc') {
        // 检测模型任务：根据模型类型选择不同的 API
        const isEmocc = selectedDetectionModel?.type === 'emoji';
        const isFealearner = selectedDetectionModel?.type === 'fealearner';
        const modelName = selectedDetectionModel?.name || (isEmocc ? 'Emocc' : 'FeaLearner');
        const finalTaskName = taskName || `${modelName}检测_${selectedUser.userHash.slice(0, 8)}`;

        if (isEmocc) {
          // Emocc 模型：调用 Emocc 检测 API
          const result = await createEmoccDetectionTask({
            userHash: selectedUser.userHash,
            dataSource: selectedSource,
            fusionModelId: selectedDetectionModel ? parseInt(selectedDetectionModel.id) : undefined,
            taskName: taskName,
          });
          newTask = {
            id: String(result.id),
            taskCode: result.taskCode,
            taskName: result.taskName || finalTaskName,
            taskMode: 'emocc',
            userHash: result.userHash,
            dataSource: result.dataSource,
            postCount: result.postCount,
            modelName: selectedDetectionModel?.name || 'Emocc',
            status: 'pending',
            progress: 0,
            resultSummary: undefined,
            createdAt: result.createdAt || new Date().toISOString(),
            startedAt: result.startedAt,
            completedAt: result.completedAt,
            processingTimeMs: result.processingTimeMs,
          };
        } else if (isFealearner) {
          // FeaLearner 模型：调用专门的 API
          const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/fealearner-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userHash: selectedUser.userHash,
              dataSource: selectedSource,
              fusionModelId: selectedDetectionModel ? parseInt(selectedDetectionModel.id) : undefined,
              taskName: taskName,
            }),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.error || '创建失败');
          const taskData = data.data;
          newTask = {
            id: String(taskData.id),
            taskCode: taskData.taskCode,
            taskName: taskData.taskName || finalTaskName,
            taskMode: 'fealearner',
            userHash: taskData.userHash,
            dataSource: taskData.dataSource,
            postCount: taskData.postCount,
            modelName: selectedDetectionModel?.name || 'FeaLearner-Reddit',
            status: 'pending',
            progress: 0,
            resultSummary: undefined,
            createdAt: taskData.createdAt || new Date().toISOString(),
            startedAt: taskData.startedAt,
            completedAt: taskData.completedAt,
            processingTimeMs: taskData.processingTimeMs,
          };
        } else {
          // 默认使用通用检测 API
          const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userHash: selectedUser.userHash,
              dataSource: selectedSource,
              taskTypeId: 1,
              taskMode: 'single',
              taskName: taskName,
              singleModelId: selectedDetectionModel ? parseInt(selectedDetectionModel.id) : undefined,
            }),
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.error || '创建失败');
          const taskData = data.data;
          newTask = {
            id: String(taskData.id),
            taskCode: taskData.taskCode,
            taskName: taskData.taskName || finalTaskName,
            taskMode: 'emocc',
            userHash: taskData.userHash,
            dataSource: taskData.dataSource,
            postCount: taskData.postCount,
            modelName: selectedDetectionModel?.name || '检测模型',
            status: 'pending',
            progress: 0,
            resultSummary: undefined,
            createdAt: taskData.createdAt || new Date().toISOString(),
            startedAt: taskData.startedAt,
            completedAt: taskData.completedAt,
            processingTimeMs: taskData.processingTimeMs,
          };
        }
      } else {
        // API 模型或本地 LLM 模型：仅创建（状态为 pending），不立即执行
        const modelId = modelCategory === 'api' ? (selectedApiModel ? parseInt(selectedApiModel.id) : undefined) : (selectedLlmModel ? parseInt(selectedLlmModel.id) : undefined);
        const modelName = modelCategory === 'api' ? selectedApiModel?.name : selectedLlmModel?.name;

        const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userHash: selectedUser.userHash,
            dataSource: selectedSource,
            taskTypeId: 1,
            taskMode: 'single',
            taskName: taskName || undefined, // 用户输入的任务名称，没输入则后端自动生成
            singleModelId: modelId,
            promptTemplateId: selectedTemplate ? parseInt(selectedTemplate.id) : undefined,
          }),
        });
        const data = await response.json();

        if (!data.success) throw new Error(data.error || '创建失败');

        const taskData = data.data;
        newTask = {
          id: String(taskData.id),
          taskCode: taskData.taskCode,
          taskName: taskData.taskName || taskName || `${modelName}_检测`,
          taskDescription: taskData.taskDescription,
          taskMode: modelCategory,
          userHash: taskData.userHash,
          dataSource: taskData.dataSource,
          postCount: taskData.postCount,
          modelId: taskData.singleModelId,
          modelName: modelName,
          // 创建后状态为 pending，执行后才会变为 completed/failed
          status: 'pending',
          progress: 0,
          resultSummary: undefined,
          createdAt: taskData.createdAt || new Date().toISOString(),
          startedAt: taskData.startedAt,
          completedAt: taskData.completedAt,
          processingTimeMs: taskData.processingTimeMs,
        };
      }

      onCreated(newTask);
      handleClose();
    } catch (err) {
      console.error('创建任务失败:', err);
      alert('创建任务失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreating(false);
      creatingRef.current = null; // 重置
    }
  };

  const handleClose = () => {
    setTaskName('');
    setSelectedSource('');
    setSelectedUser(null);
    setSelectedApiModel(null);
    setSelectedLlmModel(null);
    setSelectedDetectionModel(null);
    setSelectedTemplate(null);
    setModelCategory('api');
    creatingRef.current = null; // 重置
    onClose();
  };

  if (!isOpen) return null;

  const canProceed = !!(
    selectedSource &&
    selectedUser &&
    (modelCategory === 'emocc' && selectedDetectionModel ||
      (modelCategory === 'api' && selectedApiModel && selectedTemplate) ||
      (modelCategory === 'local_llm' && selectedLlmModel && selectedTemplate))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden m-4 animate-scale-in flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-[#F7F9FC] to-white shrink-0">
          <div>
            <h3 className="text-lg font-bold text-[#162033]">创建检测任务</h3>
            <p className="text-sm text-[#64748B] mt-0.5">配置单模型检测参数</p>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 任务名称 */}
          <div>
            <label className="block text-sm font-semibold text-[#415168] mb-2">
              任务名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-300"
              placeholder="自动生成或输入任务名称"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
            />
          </div>

          {/* 数据源 */}
          <div>
            <label className="block text-sm font-semibold text-[#415168] mb-2">
              数据源 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedSource}
              onChange={e => { setSelectedSource(e.target.value); setSelectedUser(null); }}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-300 bg-white"
            >
              <option value="">请选择数据源</option>
              {dataSources.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* 用户 */}
          <div>
            <label className="block text-sm font-semibold text-[#415168] mb-2">
              目标用户 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedUser?.id ?? ''}
              onChange={e => setSelectedUser(availableUsers.find(u => u.id === e.target.value) ?? null)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-300 bg-white"
            >
              <option value="">请选择用户</option>
              {availableUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.displayName} | {RISK_LABELS[u.riskLevel] || '未知'} | {u.postCount}条帖子
                </option>
              ))}
            </select>
            {availableUsers.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">暂无可用用户，请先导入档案数据</p>
            )}
          </div>

          {/* 模型类型选择 */}
          <div>
            <label className="block text-sm font-semibold text-[#415168] mb-3">
              检测模型 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {MODEL_CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const isActive = modelCategory === cat.value;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setModelCategory(cat.value as 'api' | 'local_llm' | 'emocc')}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      isActive
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-gray-200 hover:border-blue-200 bg-white'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className={`text-sm font-medium ${isActive ? 'text-[#162033]' : 'text-[#64748B]'}`}>
                      {cat.label}
                    </span>
                    {isActive && <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* API 模型选择 */}
          {modelCategory === 'api' && (
            <div>
              <label className="block text-sm font-medium text-[#64748B] mb-2">API 模型</label>
              {apiModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                  <Cloud className="w-8 h-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">暂无可用的 API 模型</p>
                  <p className="text-xs text-gray-400 mt-1">请在模型中心配置 MiniMax 或其他 API 模型</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {apiModels.map(model => (
                    <label
                      key={model.id}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all bg-white ${
                        selectedApiModel?.id === model.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="apiModel"
                        value={model.id}
                        checked={selectedApiModel?.id === model.id}
                        onChange={() => setSelectedApiModel(model)}
                        className="sr-only"
                      />
                      <span className="font-medium text-sm text-[#162033]">{model.name}</span>
                      <span className="text-xs text-[#64748B] mt-0.5">{model.provider}</span>
                      <span className={`mt-1 text-xs px-2 py-0.5 rounded-full ${model.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        {model.status === 'active' ? '可用' : '不可用'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 本地 LLM 选择 */}
          {modelCategory === 'local_llm' && (
            <div>
              <label className="block text-sm font-medium text-[#64748B] mb-2">本地 LLM</label>
              {llmModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                  <Server className="w-8 h-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">暂无可用的本地 LLM</p>
                  <p className="text-xs text-gray-400 mt-1">请确保 Ollama 服务已启动并配置模型</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {llmModels.map(model => (
                    <label
                      key={model.id}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all bg-white ${
                        selectedLlmModel?.id === model.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="llmModel"
                        value={model.id}
                        checked={selectedLlmModel?.id === model.id}
                        onChange={() => setSelectedLlmModel(model)}
                        className="sr-only"
                      />
                      <Bot className={`w-6 h-6 mb-1 ${model.status === 'active' ? 'text-[#2F6BFF]' : 'text-gray-300'}`} />
                      <span className="font-medium text-sm text-[#162033]">{model.name}</span>
                      <span className="text-xs text-[#64748B] mt-0.5 truncate w-full text-center">{model.path}</span>
                      <span className={`mt-1 text-xs px-2 py-0.5 rounded-full ${model.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        {model.status === 'active' ? '可用' : '不可用'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 指令模板选择 - API 模型和本地 LLM 都可选择 */}
          {(modelCategory === 'api' || modelCategory === 'local_llm') && (
            <div>
              <label className="block text-sm font-semibold text-[#415168] mb-2">
                指令模板 <span className="text-red-500">*</span>
              </label>
              {promptTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                  <FileText className="w-8 h-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">暂无可用的指令模板</p>
                  <p className="text-xs text-gray-400 mt-1">请在模型中心创建提示词模板</p>
                </div>
              ) : (
                <select
                  value={selectedTemplate?.id ?? ''}
                  onChange={e => {
                    const template = promptTemplates.find(t => t.id === e.target.value);
                    setSelectedTemplate(template || null);
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-300 bg-white text-sm"
                >
                  <option value="">请选择指令模板</option>
                  {promptTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}（{template.taskType}）
                    </option>
                  ))}
                </select>
              )}
              {selectedTemplate && (
                <div className="mt-2 p-3 bg-[#F7F9FC] rounded-xl border border-[#E2E8F0]">
                  <p className="text-xs text-[#64748B]">
                    <span className="font-medium">模板说明：</span>
                    {selectedTemplate.description || '无描述'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 检测模型选择 - 包含 Emocc 和 FeaLearner */}
          {modelCategory === 'emocc' && (
            <div>
              <label className="block text-sm font-medium text-[#64748B] mb-2">检测模型</label>
              {detectionModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                  <Brain className="w-8 h-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">暂无可用的检测模型</p>
                  <p className="text-xs text-gray-400 mt-1">请在模型中心配置 Emocc 或 FeaLearner 模型</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {detectionModels.map(model => (
                    <label
                      key={model.id}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all bg-white ${
                        selectedDetectionModel?.id === model.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="detectionModel"
                        value={model.id}
                        checked={selectedDetectionModel?.id === model.id}
                        onChange={() => setSelectedDetectionModel(model)}
                        className="sr-only"
                      />
                      <Brain className={`w-6 h-6 mb-1 ${model.status === 'active' ? 'text-purple-500' : 'text-gray-300'}`} />
                      <span className="font-medium text-sm text-[#162033]">{model.name}</span>
                      <span className="text-xs text-[#64748B] mt-0.5 truncate w-full text-center">{model.path}</span>
                      <span className={`mt-1 text-xs px-2 py-0.5 rounded-full ${model.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                        {model.status === 'active' ? '可用' : '不可用'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end items-center gap-3 p-5 border-t border-gray-100 bg-[#F7F9FC] shrink-0">
          <button onClick={handleClose} className="px-5 py-2.5 bg-white hover:bg-gray-100 text-[#415168] rounded-xl transition-colors text-sm font-medium border border-gray-200">
            取消
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!creating && canProceed) handleCreate(); }}
            disabled={!canProceed || creating}
            className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm flex items-center gap-2 shadow-sm"
          >
            {creating ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {creating ? '创建中...' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 报告 HTML 生成 ====================

function buildReportHtml(reportData: any): string {
  const rs = reportData.resultSummary || {};
  const emocc = rs.emoccModelResult;
  const riskLevel = rs.riskLevel || 'medium';
  const riskScore = rs.riskScore ?? 0.5;
  const confidence = rs.confidence ?? 80;

  const riskColors: Record<string, string> = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  const riskLabels: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };
  const riskColor = riskColors[riskLevel] || '#f59e0b';
  const riskLabel = riskLabels[riskLevel] || '未知';

  const escapeHtml = (str: string) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderList = (items: string[]) => {
    if (!items?.length) return '';
    return `<ul style="margin:6px 0 6px 20px;padding:0;list-style:none;">${items.map((item: string) => `<li style="margin-bottom:4px;padding-left:8px;">${escapeHtml(item)}</li>`).join('')}</ul>`;
  };

  const probLabels = ['无风险', '极低风险', '低风险', '中风险', '高风险'];
  const probColors = ['#22c55e', '#86efac', '#fde047', '#f97316', '#ef4444'];
  const classProbs = emocc?.classProbs || [];
  const probBars = classProbs.map((prob: number | string, i: number) => {
    const probNum = typeof prob === 'number' ? prob : parseFloat(prob);
    const barWidth = probNum * 100;
    return `<div style="display:flex;align-items:center;margin-bottom:4px;">
      <span style="width:64px;font-size:11px;">${probLabels[i]}</span>
      <div style="flex:1;background:#f0f0f0;border-radius:4px;height:12px;margin:0 8px;">
        <div style="width:${barWidth.toFixed(1)}%;background:${probColors[i]};border-radius:4px;height:100%;"></div>
      </div>
      <span style="width:44px;font-size:11px;text-align:right;">${(probNum * 100).toFixed(1)}%</span>
    </div>`;
  }).join('');

  const attScores = (emocc?.postAttentionScores || []);
  const totalAttention = attScores.reduce((sum: number, s: any) => sum + parseFloat(s.attentionScore ?? s.attention_score ?? 0), 0);
  const attRows = attScores.map((s: any) => {
    const attention = parseFloat(s.attentionScore ?? s.attention_score ?? 0);
    const percentage = totalAttention > 0 ? ((attention / totalAttention) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">Post-${s.postIndex ?? s.post_index ?? '-'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">${attention.toFixed(4)} (${percentage}%)</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.textPreview ?? s.text_preview ?? '')}</td>
    </tr>`;
  }).join('');

  const completedAt = reportData.completedAt ? new Date(reportData.completedAt).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>自杀风险临床评估报告 - ${escapeHtml(reportData.userHash || '')}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 14px; color: #333; background: white; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px; }
  .header { border-bottom: 3px solid ${riskColor}; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; color: #222; margin-bottom: 8px; }
  .header .meta { font-size: 12px; color: #888; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 15px; font-weight: bold; color: #222; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  .section p { line-height: 1.8; color: #444; text-align: justify; }
  .risk-banner { display: flex; gap: 16px; margin: 16px 0; }
  .risk-card { flex: 1; background: #fafafa; border-radius: 8px; padding: 16px; text-align: center; border: 1px solid #eee; }
  .risk-card .label { font-size: 12px; color: #888; margin-bottom: 4px; }
  .risk-card .value { font-size: 22px; font-weight: bold; }
  .risk-card .sub { font-size: 11px; color: #aaa; }
  .risk-level-box { background: ${riskColor}; color: white; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 16px; }
  .risk-level-box .level { font-size: 28px; font-weight: bold; }
  .risk-level-box .score { font-size: 14px; opacity: 0.9; margin-top: 4px; }
  .factor-red { background: #fef2f2; border-left: 3px solid #ef4444; padding: 12px; border-radius: 4px; }
  .factor-green { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 12px; border-radius: 4px; }
  .advice-box { background: #eff6ff; border-left: 3px solid #3b82f6; padding: 12px; border-radius: 4px; }
  .intervention-box { background: #fff7ed; border-left: 3px solid #f97316; padding: 12px; border-radius: 4px; }
  .followup-box { background: #f5f3ff; border-left: 3px solid #8b5cf6; padding: 12px; border-radius: 4px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; text-align: center; line-height: 1.8; }
  .print-btn { position: fixed; top: 20px; right: 20px; background: #f97316; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .print-btn:hover { background: #ea580c; }
  .emocc-section { margin-top:16px;padding:12px;background:#f8f4ff;border-radius:8px;border:1px solid #e9d5ff; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">打印 / 导出 PDF</button>
<div class="page">
  <div class="header">
    <h1>自杀风险临床评估报告</h1>
    <div class="meta">
      用户哈希: ${escapeHtml(reportData.userHash || '')} &nbsp;|&nbsp;
      帖子数: ${reportData.postCount || 0} &nbsp;|&nbsp;
      评估时间: ${completedAt}
    </div>
  </div>

  <div class="risk-level-box">
    <div class="level">${riskLabel}</div>
    <div class="score">风险分数: ${riskScore.toFixed(2)} / 置信度: ${confidence}% / 融合模型: ${escapeHtml(rs.llmModel || rs.emotionalAnalysis ? (reportData.modelName || 'qwen-flash') : '')}</div>
  </div>

  <div class="risk-banner">
    <div class="risk-card">
      <div class="label">风险等级</div>
      <div class="value" style="color:${riskColor};">${riskLabel}</div>
    </div>
    <div class="risk-card">
      <div class="label">风险分数</div>
      <div class="value">${riskScore.toFixed(2)}</div>
      <div class="sub">0=无风险，1=高风险</div>
    </div>
    <div class="risk-card">
      <div class="label">置信度</div>
      <div class="value">${confidence}%</div>
    </div>
  </div>

  ${rs.summary || rs.emotionalAnalysis ? `<div class="section"><div class="section-title">综合评估摘要</div><p>${escapeHtml(rs.summary || rs.emotionalAnalysis || '')}</p></div>` : ''}
  ${rs.symptomDescription ? `<div class="section"><div class="section-title">临床症状描述</div><p>${escapeHtml(rs.symptomDescription)}</p></div>` : ''}
  ${rs.emotionalAnalysis ? `<div class="section"><div class="section-title">情绪分析</div><p>${escapeHtml(rs.emotionalAnalysis)}</p></div>` : ''}
  ${rs.riskInterpretation ? `<div class="section"><div class="section-title">风险解读</div><p>${escapeHtml(rs.riskInterpretation)}</p></div>` : ''}

  ${emocc ? `<div class="emocc-section">
    <div style="font-weight:bold;color:#7c3aed;margin-bottom:8px;">Emocc 模型检测详情</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
      <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
        <div style="font-size:11px;color:#888;">原始风险等级</div>
        <div style="font-weight:bold;color:#7c3aed;">${escapeHtml(emocc.riskLevel || emocc.risk_level || '')}</div>
      </div>
      <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
        <div style="font-size:11px;color:#888;">原始风险分数</div>
        <div style="font-weight:bold;color:#7c3aed;">${parseFloat(emocc.riskScore || emocc.risk_score || 0).toFixed(4)}</div>
      </div>
      <div style="background:white;padding:8px;border-radius:6px;text-align:center;">
        <div style="font-size:11px;color:#888;">五分类结果</div>
        <div style="font-weight:bold;color:#7c3aed;">Class ${emocc.riskClass || emocc.risk_class || '-'}</div>
      </div>
    </div>
    <div style="font-size:12px;color:#555;margin-bottom:6px;">概率分布</div>
    ${probBars}
  </div>` : ''}

  ${rs.riskFactors?.length ? `<div class="section factor-red"><div class="section-title">风险因素</div>${renderList(rs.riskFactors)}</div>` : ''}
  ${rs.protectiveFactors?.length ? `<div class="section factor-green"><div class="section-title">保护因素</div>${renderList(rs.protectiveFactors)}</div>` : ''}
  ${rs.interventionSuggestion ? `<div class="section intervention-box"><div class="section-title">干预建议</div><p>${escapeHtml(rs.interventionSuggestion)}</p></div>` : ''}
  ${rs.professionalAdvice ? `<div class="section advice-box"><div class="section-title">专业建议</div><p>${escapeHtml(rs.professionalAdvice)}</p></div>` : ''}
  ${rs.followUpSuggestion ? `<div class="section followup-box"><div class="section-title">随访建议</div><p>${escapeHtml(rs.followUpSuggestion)}</p></div>` : ''}

  ${attScores.length ? `<div class="section">
    <div style="font-weight:bold;color:#555;margin-bottom:6px;">高注意力帖子（共 ${attScores.length} 条，注意力总和: ${totalAttention.toFixed(4)}）</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f9f9f9;">
        <th style="padding:6px 8px;text-align:left;font-size:12px;">序号</th>
        <th style="padding:6px 8px;text-align:left;font-size:12px;">注意力分数</th>
        <th style="padding:6px 8px;text-align:left;font-size:12px;">内容预览</th>
      </tr></thead>
      <tbody>${attRows}</tbody>
    </table>
  </div>` : ''}

  <div class="footer">
    本报告由 VIS4SRD 自杀风险可视化检测系统生成 | 本报告仅供参考，最终诊断应由持证专业医生做出<br>
    报告生成时间: ${new Date().toLocaleString('zh-CN')} | 系统版本: ECML-PKDD 2026 Demo
  </div>
</div>
</body>
</html>`;
}

// ==================== 结果详情页 ====================

interface ResultPageProps {
  task: RiskTask;
  onBack: () => void;
}

function ResultPage({ task, onBack }: ResultPageProps) {
  const result = task.resultSummary;
  const rc = result ? RISK_COLORS[result.riskLevel] : null;
  const emocc = result?.emoccModelResult;
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const formatTime = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const handleGenerateReport = async () => {
    if (!task.resultSummary) return;
    setIsGeneratingReport(true);
    try {
      const reportData = await fetchRiskReport(task.id);
      const html = buildReportHtml(reportData);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    } catch (err) {
      console.error('生成报告失败:', err);
      alert('生成报告失败，请稍后重试');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-2 text-[#64748B] hover:text-[#162033] transition-colors group">
        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        <span className="text-sm font-medium">返回列表</span>
      </button>

      {/* 任务信息 */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 text-sm text-[#64748B]">
          <span className="flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            用户: <span className="font-medium text-[#415168]">{task.userHash}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            帖子: <span className="font-medium text-[#415168]">{task.postCount}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Activity className="w-4 h-4" />
            模型: <span className="font-medium text-[#415168]">{task.modelName}</span>
          </span>
          {task.completedAt && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              耗时: <span className="font-medium text-[#415168]">{formatTime(task.processingTimeMs)}</span>
            </span>
          )}
        </div>
      </div>

      {/* 风险结果 */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#162033] mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#2F6BFF]" />
          检测结果
        </h3>
        {result && rc ? (
          <>
            {/* 风险等级 + 分数 + 置信度 */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className={`${rc.bg} border ${rc.border} rounded-xl p-5 text-center`}>
                <p className="text-sm text-[#64748B] mb-3">风险等级</p>
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-base font-bold ${rc.text}`}>
                  <AlertTriangle className="w-5 h-5" />
                  {RISK_LABELS[result.riskLevel]}
                </div>
              </div>
              <div className="bg-gradient-to-br from-[#F7FAFD] to-[#F3F8FF] rounded-xl p-5 text-center border border-[#E2E8F0]">
                <p className="text-sm text-[#64748B] mb-3">风险分数</p>
                <p className="text-3xl font-bold text-[#162033]">{(result.riskScore ?? 0).toFixed(2)}</p>
                <p className="text-xs text-[#94A3B8] mt-1">(0-1范围)</p>
              </div>
              <div className="bg-gradient-to-br from-[#F7FAFD] to-[#F3F8FF] rounded-xl p-5 text-center border border-[#E2E8F0]">
                <p className="text-sm text-[#64748B] mb-3">置信度</p>
                <p className="text-3xl font-bold text-[#162033]">{result.confidence}%</p>
              </div>
            </div>

            {/* 综合评估摘要 */}
            {result.summary && (
              <div className="bg-gradient-to-r from-[#F1F5FA] to-[#F7F9FC] rounded-xl p-5 border border-[#E2E8F0] mb-4">
                <p className="text-sm font-semibold text-[#415168] mb-2">综合评估摘要</p>
                <p className="text-sm text-[#415168] leading-relaxed">{result.summary}</p>
              </div>
            )}

            {/* 临床症状 / 情绪分析 / 风险解读 */}
            {(result.symptomDescription || result.emotionalAnalysis || result.riskInterpretation) && (
              <div className="grid grid-cols-1 gap-3 mb-4">
                {result.symptomDescription && (
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-50">
                    <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> 临床症状描述
                    </p>
                    <p className="text-xs text-blue-700 leading-relaxed">{result.symptomDescription}</p>
                  </div>
                )}
                {result.emotionalAnalysis && (
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                      <Brain className="w-4 h-4" /> 情绪分析
                    </p>
                    <p className="text-xs text-blue-700 leading-relaxed">{result.emotionalAnalysis}</p>
                  </div>
                )}
                {result.riskInterpretation && (
                  <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                    <p className="text-sm font-semibold text-purple-800 mb-2 flex items-center gap-1.5">
                      <Activity className="w-4 h-4" /> 风险解读
                    </p>
                    <p className="text-xs text-purple-700 leading-relaxed">{result.riskInterpretation}</p>
                  </div>
                )}
              </div>
            )}

            {/* Emocc 详细结果 */}
            {emocc && (
              <div className="mt-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-5 border border-purple-200">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
                    <Brain className="w-4 h-4" /> Emocc 模型详情
                  </p>
                  <span className="text-xs text-purple-500 bg-purple-100 px-2 py-0.5 rounded-full">
                    {emocc.modelType === 'emocc_local' ? '真实模型' : '模拟模型'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                    <p className="text-xs text-purple-600 mb-1">原始风险等级</p>
                    <p className="font-bold text-purple-800">{RISK_LABELS[emocc.riskLevel as keyof typeof RISK_LABELS] || emocc.riskLevel}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                    <p className="text-xs text-purple-600 mb-1">原始风险分数</p>
                    <p className="font-bold text-purple-800">{(emocc.riskScore ?? 0).toFixed(4)}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                    <p className="text-xs text-purple-600 mb-1">五分类结果</p>
                    <p className="font-bold text-purple-800">Class {emocc.riskClass}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                    <p className="text-xs text-purple-600 mb-1">置信度</p>
                    <p className="font-bold text-purple-800">{((emocc.confidence ?? 0) * 100).toFixed(1)}%</p>
                  </div>
                </div>

                {/* 概率分布条形图 */}
                {emocc.classProbs && emocc.classProbs.length === 5 && (
                  <div className="bg-white rounded-lg p-3 border border-purple-100 mb-3">
                    <p className="text-xs text-purple-600 mb-2 font-medium">五分类概率分布</p>
                    <div className="space-y-1.5">
                      {emocc.classProbs.map((prob: number, idx: number) => {
                        const labels = ['无风险', '极低风险', '低风险', '中风险', '高风险'];
                        const colors = ['bg-green-400', 'bg-green-300', 'bg-yellow-300', 'bg-blue-500', 'bg-red-400'];
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-purple-600 w-16 shrink-0">{labels[idx]}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                              <div className={`h-full rounded-full ${colors[idx]}`} style={{ width: `${prob * 100}%` }} />
                            </div>
                            <span className="text-xs text-purple-600 w-10 text-right">{(prob * 100).toFixed(1)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 高注意力帖子 */}
                {emocc.postAttentionScores && emocc.postAttentionScores.length > 0 && (() => {
                  const totalAttention = emocc.postAttentionScores.reduce((sum: number, s: any) => sum + ((s.attentionScore as number) ?? (s.attention_score as number) ?? 0), 0);
                  return (
                    <div className="bg-white rounded-lg p-3 border border-purple-100">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-purple-600 font-medium">
                          高注意力帖子（模型重点关注）
                          <span className="ml-2 text-purple-400">（共 {emocc.postAttentionScores.length} 条）</span>
                        </p>
                        <p className="text-xs text-purple-500">
                          注意力总和: <span className="font-bold text-purple-700">{totalAttention.toFixed(4)}</span>
                        </p>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {emocc.postAttentionScores.map((s: any, idx: number) => {
                          const attention = (s.attentionScore as number) ?? (s.attention_score as number) ?? 0;
                          const percentage = totalAttention > 0 ? ((attention / totalAttention) * 100).toFixed(1) : '0.0';
                          return (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded shrink-0 mt-0.5">#{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs text-purple-500">
                                    注意力: <span className="font-bold text-purple-700">{attention.toFixed(4)}</span>
                                    <span className="text-purple-400 ml-1">({percentage}%)</span>
                                  </span>
                                </div>
                                <p className="text-xs text-purple-700 leading-relaxed truncate">{((s.textPreview as string) ?? (s.text_preview as string) ?? '')}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 风险/保护因素 */}
            {(result.riskFactors?.length || result.protectiveFactors?.length) && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                {result.riskFactors?.length && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                    <p className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> 风险因素
                    </p>
                    <ul className="space-y-1.5">
                      {result.riskFactors.map((f: string, i: number) => (
                        <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.protectiveFactors?.length && (
                  <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                    <p className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1.5">
                      <Shield className="w-4 h-4" /> 保护因素
                    </p>
                    <ul className="space-y-1.5">
                      {result.protectiveFactors.map((f: string, i: number) => (
                        <li key={i} className="text-xs text-green-700 flex items-start gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* 干预建议 */}
            {result.interventionSuggestion && (
              <div className="mt-4 bg-blue-50 rounded-xl p-4 border border-blue-200">
                <p className="text-sm font-semibold text-blue-900 mb-2">干预建议</p>
                <p className="text-xs text-blue-700 leading-relaxed">{result.interventionSuggestion}</p>
              </div>
            )}

            {/* 专业建议 */}
            {result.professionalAdvice && (
              <div className="mt-4 bg-blue-50 rounded-xl p-4 border border-blue-200">
                <p className="text-sm font-semibold text-blue-800 mb-2">专业建议</p>
                <p className="text-xs text-blue-700 leading-relaxed">{result.professionalAdvice}</p>
              </div>
            )}

            {/* 随访建议 */}
            {result.followUpSuggestion && (
              <div className="mt-4 bg-indigo-50 rounded-xl p-4 border border-indigo-200">
                <p className="text-sm font-semibold text-indigo-800 mb-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4" /> 随访建议
                </p>
                <p className="text-xs text-indigo-700 leading-relaxed">{result.followUpSuggestion}</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-[#64748B]">
            <Activity className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">暂无详细结果</p>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-center gap-4 pt-2">
        <button
          onClick={handleGenerateReport}
          disabled={isGeneratingReport || !task.resultSummary}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-all font-semibold shadow-sm">
          {isGeneratingReport ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <FileText className="w-5 h-5" />
          )}
          {isGeneratingReport ? '生成中...' : '生成报告'}
        </button>
        <button onClick={() => window.location.href = '/map'} className="flex items-center gap-2 px-6 py-3 bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#162033] rounded-xl transition-colors font-medium shadow-sm">
          <TrendingUp className="w-5 h-5" />
          查看资源
        </button>
      </div>
    </div>
  );
}

// ==================== 确认弹窗 ====================

function DeleteConfirmModal({ isOpen, onClose, onConfirm, taskName }: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void; taskName: string;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm m-4 animate-scale-in overflow-hidden border border-[#E2E8F0]">
        <div className="p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 border border-red-200">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-[#162033] mb-2">确认删除</h3>
          <p className="text-sm text-[#64748B]">
            确定要删除任务 <span className="font-semibold text-[#415168]">"{taskName}"</span> 吗？此操作不可撤销。
          </p>
        </div>
        <div className="flex gap-3 p-4 border-t border-[#E2E8F0] bg-[#F7F9FC]">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-white hover:bg-gray-100 text-[#415168] rounded-xl transition-colors text-sm font-medium border border-gray-200">
            取消
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors text-sm font-medium">
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面 ====================

export default function RiskPage() {
  // 状态
  const [viewMode, setViewMode] = useState<'list' | 'result'>('list');
  const [selectedTask, setSelectedTask] = useState<RiskTask | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [tasks, setTasks] = useState<RiskTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RiskTask | null>(null);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);

  // 筛选状态
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 数据源和配置
  const [dataSources, setDataSources] = useState<{ value: string; label: string }[]>([
    { value: 'reddit', label: 'Reddit 数据' },
  ]);
  const [availableUsers, setAvailableUsers] = useState<{ id: string; userHash: string; displayName: string; riskLevel: string; postCount: number }[]>([]);

  // 加载数据
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [emoccRes, riskRes, fealearnerRes] = await Promise.allSettled([
        fetchEmoccTasks({ limit: 100 }),
        fetchDetectionTasks({ limit: 100 }),
        fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/fealearner-tasks?limit=100`).then(r => r.json()).catch(() => ({ data: { tasks: [] } })),
      ]);

      const allTasks: RiskTask[] = [];

      // 加载 Emocc 任务
      if (emoccRes.status === 'fulfilled' && emoccRes.value.tasks) {
        emoccRes.value.tasks.forEach((t: EmoccTaskResult) => {
          allTasks.push({
            id: String(t.id),
            taskCode: t.taskCode,
            taskName: t.taskName,
            taskDescription: t.taskDescription,
            taskMode: 'emocc',
            userHash: t.userHash,
            dataSource: t.dataSource,
            postCount: t.postCount,
            modelName: t.modelName || 'Emocc-Reddit',
            status: t.status as TaskStatus,
            progress: t.progress,
            resultSummary: t.resultSummary ? {
              riskLevel: (t.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: t.resultSummary.riskScore || 0.5,
              confidence: t.resultSummary.confidence || 80,
              summary: t.resultSummary.summary || '',
              emoccModelResult: t.resultSummary.emoccModelResult,
              symptomDescription: t.resultSummary.symptomDescription,
              emotionalAnalysis: t.resultSummary.emotionalAnalysis,
              riskInterpretation: t.resultSummary.riskInterpretation,
              riskFactors: t.resultSummary.riskFactors,
              protectiveFactors: t.resultSummary.protectiveFactors,
              professionalAdvice: t.resultSummary.professionalAdvice,
              interventionSuggestion: t.resultSummary.interventionSuggestion,
              followUpSuggestion: t.resultSummary.followUpSuggestion,
            } : undefined,
            createdAt: t.createdAt,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
            processingTimeMs: t.processingTimeMs,
          });
        });
      }

      // 加载 FeaLearner 任务
      if (fealearnerRes.status === 'fulfilled' && fealearnerRes.value?.data?.tasks) {
        fealearnerRes.value.data.tasks.forEach((t: any) => {
          allTasks.push({
            id: String(t.id),
            taskCode: t.taskCode,
            taskName: t.taskName,
            taskDescription: t.taskDescription,
            taskMode: 'fealearner',
            userHash: t.userHash,
            dataSource: t.dataSource,
            postCount: t.postCount,
            modelName: t.modelName || 'FeaLearner-Reddit',
            status: t.status as TaskStatus,
            progress: t.progress || 0,
            resultSummary: t.resultSummary ? {
              riskLevel: (t.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: t.resultSummary.riskScore || 0.5,
              confidence: t.resultSummary.confidence || 80,
              summary: t.resultSummary.summary || '',
              symptomDescription: t.resultSummary.symptomDescription,
              emotionalAnalysis: t.resultSummary.emotionalAnalysis,
              riskInterpretation: t.resultSummary.riskInterpretation,
              riskFactors: t.resultSummary.riskFactors,
              protectiveFactors: t.resultSummary.protectiveFactors,
              professionalAdvice: t.resultSummary.professionalAdvice,
              interventionSuggestion: t.resultSummary.interventionSuggestion,
              followUpSuggestion: t.resultSummary.followUpSuggestion,
            } : undefined,
            createdAt: t.createdAt,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
            processingTimeMs: t.processingTimeMs,
          });
        });
      }

      // 加载 Risk 检测任务（排除已由 FeaLearner API 返回的任务，避免重复）
      if (riskRes.status === 'fulfilled' && riskRes.value.tasks) {
        const fealearnerIds = new Set(
          fealearnerRes.status === 'fulfilled' && fealearnerRes.value?.data?.tasks
            ? fealearnerRes.value.data.tasks.map((t: any) => String(t.id))
            : []
        );
        riskRes.value.tasks.forEach((t: any) => {
          if (fealearnerIds.has(String(t.id))) return;
          allTasks.push({
            id: String(t.id),
            taskCode: t.taskCode,
            taskName: t.taskName,
            taskDescription: t.taskDescription,
            taskMode: t.singleModelId ? 'api' : 'local_llm',
            userHash: t.userHash,
            dataSource: t.dataSource,
            postCount: t.postCount,
            modelId: t.singleModelId,
            modelName: t.modelName || '检测模型',
            status: t.status as TaskStatus,
            progress: t.progress || 0,
            resultSummary: t.resultSummary ? {
              riskLevel: (t.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: t.resultSummary.riskScore || 0.5,
              confidence: t.resultSummary.confidence || 80,
              summary: t.resultSummary.summary || '',
              riskFactors: t.resultSummary.keyRiskFactors,
              protectiveFactors: t.resultSummary.protectiveFactors,
              professionalAdvice: t.resultSummary.professionalAdvice,
            } : undefined,
            createdAt: t.createdAt,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
            processingTimeMs: t.processingTimeMs,
          });
        });
      }

      setTasks(allTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (err) {
      console.error('加载任务失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化
  useEffect(() => {
    const init = async () => {
      // 加载数据源
      try {
        const datasets = await fetchDatasets();
        if (datasets && datasets.length > 0) {
          setDataSources(datasets.map((d: any) => ({ value: d.datasetKey, label: d.displayName })));
        }
      } catch {}

      // 加载用户列表（直接从本地 CSV 文件加载全部 500 条）
      try {
        const response = await fetch('/reddit_500.csv');
        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        // 跳过表头，从第2行开始
        const users = lines.slice(1).map((line) => {
          const parts = line.split(',');
          const userName = parts[0]?.trim() || '';
          const label = parseInt(parts[parts.length - 1]?.trim() || '0', 10);
          // 计算帖子数量（粗略估算：整个 Post 字段的逗号数量）
          const postStr = line.substring(line.indexOf('"') + 1, line.lastIndexOf('"'));
          const commaCount = (postStr.match(/,/g) || []).length;
          const postCount = Math.max(1, Math.min(100, Math.floor(commaCount / 5)));

          // 生成与后端一致的用户哈希: md5("reddit_" + userName)[:12]
          const userHash = md5(`reddit_${userName}`).substring(0, 12);

          // Label 转 riskLevel: 0->无风险, 1->极低, 2->低, 3->中, 4->高
          let riskLevel = 'low';
          if (label === 0) riskLevel = 'no-risk';
          else if (label === 1) riskLevel = 'very-low';
          else if (label === 2) riskLevel = 'low';
          else if (label === 3) riskLevel = 'medium';
          else if (label === 4) riskLevel = 'high';

          return {
            id: userHash,
            userHash: userHash,
            displayName: userName,
            riskLevel,
            postCount,
          };
        }).filter(u => u.userHash);

        if (users.length > 0) {
          setAvailableUsers(users);
        }
      } catch (err) {
        console.error('加载 CSV 用户列表失败:', err);
      }
    };

    init();
    loadTasks();
  }, [loadTasks]);

  // 统计
  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    running: tasks.filter(t => t.status === 'running').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    highRisk: tasks.filter(t => t.resultSummary?.riskLevel === 'high').length,
  };

  // 筛选
  const filteredTasks = tasks.filter(task => {
    if (filterStatus && task.status !== filterStatus) return false;
    if (filterSource && task.dataSource !== filterSource) return false;
    if (filterType && task.taskMode !== filterType) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 操作
  const handleViewTask = (task: RiskTask) => {
    setSelectedTask(task);
    setViewMode('result');
  };

  const handleDelete = async (task: RiskTask) => {
    try {
      if (task.taskMode === 'emocc') {
        await deleteEmoccTask(task.id);
      } else if (task.taskMode === 'fealearner') {
        await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/fealearner-tasks/${task.id}`, { method: 'DELETE' });
      } else {
        await deleteDetectionTask(task.id);
      }
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败');
    }
    setDeleteTarget(null);
  };

  const handleExecute = async (task: RiskTask) => {
    if (executingTaskId) return;
    setExecutingTaskId(task.id);
    try {
      let result;
      
      if (task.taskMode === 'emocc') {
        // Emocc 任务：调用专门的执行接口
        result = await executeEmoccTask(parseInt(task.id));
        
        if (result.success) {
          setTasks(prev => prev.map(t => t.id === task.id ? {
            ...t,
            status: 'completed',
            progress: 100,
            resultSummary: result.resultSummary ? {
              riskLevel: (result.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: result.resultSummary.riskScore || 0.5,
              confidence: result.resultSummary.confidence || 80,
              summary: result.resultSummary.summary || '检测完成',
              emoccModelResult: result.resultSummary.emoccModelResult,
              symptomDescription: result.resultSummary.symptomDescription,
              emotionalAnalysis: result.resultSummary.emotionalAnalysis,
              riskInterpretation: result.resultSummary.riskInterpretation,
              riskFactors: result.resultSummary.riskFactors,
              protectiveFactors: result.resultSummary.protectiveFactors,
              professionalAdvice: result.resultSummary.professionalAdvice,
              interventionSuggestion: result.resultSummary.interventionSuggestion,
              followUpSuggestion: result.resultSummary.followUpSuggestion,
            } : undefined,
            completedAt: result.completedAt || new Date().toISOString(),
            processingTimeMs: result.processingTimeMs,
          } : t));
        }
      } else if (task.taskMode === 'fealearner') {
        // FeaLearner 任务：调用专门的执行接口
        const feaRes = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/risk/fealearner-tasks/${task.id}/execute`, {
          method: 'POST',
        });
        result = await feaRes.json();
        
        if (result.success) {
          setTasks(prev => prev.map(t => t.id === task.id ? {
            ...t,
            status: 'completed',
            progress: 100,
            resultSummary: result.resultSummary ? {
              riskLevel: (result.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: result.resultSummary.riskScore || 0.5,
              confidence: result.resultSummary.confidence || 80,
              summary: result.resultSummary.summary || 'FeaLearner 检测完成',
              symptomDescription: result.resultSummary.symptomDescription,
              emotionalAnalysis: result.resultSummary.emotionalAnalysis,
              riskInterpretation: result.resultSummary.riskInterpretation,
              riskFactors: result.resultSummary.riskFactors,
              protectiveFactors: result.resultSummary.protectiveFactors,
              professionalAdvice: result.resultSummary.professionalAdvice,
              interventionSuggestion: result.resultSummary.interventionSuggestion,
              followUpSuggestion: result.resultSummary.followUpSuggestion,
            } : undefined,
            completedAt: result.completedAt || new Date().toISOString(),
            processingTimeMs: result.processingTimeMs,
          } : t));
        }
      } else {
        // 普通任务：调用通用执行接口
        result = await executeDetectionTask(task.id);
        
        if (result.success) {
          setTasks(prev => prev.map(t => t.id === task.id ? {
            ...t,
            status: 'completed',
            progress: 100,
            resultSummary: result.resultSummary ? {
              riskLevel: (result.resultSummary.riskLevel || 'medium') as 'low' | 'medium' | 'high',
              riskScore: result.resultSummary.riskScore || 0.5,
              confidence: result.resultSummary.confidence || 80,
              summary: result.resultSummary.summary || '检测完成',
              riskFactors: result.resultSummary.keyRiskFactors,
              protectiveFactors: result.resultSummary.protectiveFactors,
              professionalAdvice: result.resultSummary.professionalAdvice,
            } : undefined,
            completedAt: result.completedAt || new Date().toISOString(),
            processingTimeMs: result.processingTimeMs,
          } : t));
        }
      }
      
      if (!result.success) {
        alert('执行失败: ' + (result.error || result.message || '未知错误'));
      }
    } catch (err) {
      console.error('执行失败:', err);
      alert('执行失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExecutingTaskId(null);
    }
  };

  const handleBack = () => {
    setViewMode('list');
    setSelectedTask(null);
    loadTasks();
  };

  const handleTaskCreated = (task: RiskTask) => {
    setTasks(prev => [task, ...prev]);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const statCards = [
    {
      label: '检测任务',
      value: stats.total,
      note: '覆盖 API、本地 LLM、Emocc 与 FeaLearner 的检测任务总量',
      icon: Activity,
      tone: 'blue' as const,
    },
    {
      label: '已完成',
      value: stats.completed,
      note: '已形成风险结论、摘要与后续干预建议的任务数量',
      icon: CheckCircle,
      tone: 'green' as const,
    },
    {
      label: '执行中',
      value: stats.running,
      note: '正在进行模型推理、结果汇总或报告生成的任务',
      icon: Loader,
      tone: 'cyan' as const,
    },
    {
      label: '高风险',
      value: stats.highRisk,
      note: '需优先复核与转介跟进的高风险检测结果数量',
      icon: AlertTriangle,
      tone: 'red' as const,
    },
  ];

  // ==================== 渲染 ====================

  if (viewMode === 'result' && selectedTask) {
    return (
      <div className="p-6">
        <ResultPage task={selectedTask} onBack={handleBack} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="grid grid-cols-1 gap-3 shrink-0 md:grid-cols-2 xl:grid-cols-4">
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

      {/* 筛选栏 */}
      <div className="shrink-0 bg-white rounded-[28px] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0]">
        <div className="flex flex-wrap items-center gap-3">
          {/* 数据源筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">数据源</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 text-sm bg-[#F7F9FC] min-w-[120px]"
              value={filterSource}
              onChange={e => { setFilterSource(e.target.value); setCurrentPage(1); }}
            >
              <option value="">全部</option>
              {dataSources.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* 状态筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">状态</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 text-sm bg-[#F7F9FC] min-w-[100px]"
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            >
              <option value="">全部</option>
              {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>

          {/* 模型类型筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">模型</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 text-sm bg-[#F7F9FC] min-w-[130px]"
              value={filterType}
              onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}
            >
              <option value="">全部</option>
              {MODEL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <button onClick={() => { setFilterStatus(''); setFilterSource(''); setFilterType(''); setCurrentPage(1); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] rounded-xl transition-colors text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> 重置
          </button>

          {/* 新建按钮 */}
          <div className="ml-auto">
            <button onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-700 text-white rounded-xl transition-all text-sm font-medium shadow-sm">
              <Plus className="w-4 h-4" /> 新建任务
            </button>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 min-h-0 bg-white rounded-[28px] shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[#E8EEF6] bg-[#FCFDFF] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#162033]">风险检测任务列表</h2>
            <p className="mt-1 text-sm text-[#6B7B8F]">统一查看任务名称、数据来源、模型类型、执行状态与结果入口。</p>
          </div>
        </div>
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-[#F7FAFD] to-white sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">任务名称</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">数据源</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">模型</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">状态</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">创建时间</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAF0F6]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#64748B]">
                    <Loader className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-300" />
                    <p className="text-sm">加载中...</p>
                  </td>
                </tr>
              ) : paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#64748B]">
                    <Activity className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">暂无检测任务</p>
                    <p className="text-xs text-gray-400 mt-1">点击上方"新建任务"开始检测</p>
                  </td>
                </tr>
              ) : (
                paginatedTasks.map(task => {
                  const statusInfo = STATUS_CONFIG[task.status];
                  const rc = task.resultSummary ? RISK_COLORS[task.resultSummary.riskLevel] : null;
                  const modelCategory = MODEL_CATEGORIES.find(c => c.value === task.taskMode);
                  const ModelIcon = modelCategory?.icon || Activity;

                  return (
                    <tr key={task.id} className="hover:bg-[#F7F9FC] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="text-sm font-medium text-[#162033] max-w-[200px] truncate">
                            {task.taskName}
                          </span>
                          {rc && task.resultSummary && (
                            <span className={`px-1.5 py-0.5 ${rc.bg} ${rc.text} text-xs rounded-full font-medium shrink-0`}>
                              {RISK_LABELS[task.resultSummary!.riskLevel]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">
                          {dataSources.find(s => s.value === task.dataSource)?.label || task.dataSource}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-sm text-[#415168]">
                          <ModelIcon className={`w-4 h-4 ${task.taskMode === 'emocc' ? 'text-purple-400' : task.taskMode === 'api' ? 'text-blue-400' : 'text-gray-400'}`} />
                          {task.modelName || modelCategory?.label || '未知'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 ${statusInfo.bg} ${statusInfo.text} text-xs rounded-full font-medium`}>
                            {statusInfo.label}
                          </span>
                          {task.status === 'running' && task.progress > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.progress}%` }} />
                              </div>
                              <span className="text-xs text-blue-600">{task.progress}%</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#415168]">{formatDate(task.createdAt)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {/* 开始执行按钮：始终显示，执行后变灰色 */}
                          <button
                            onClick={() => handleExecute(task)}
                            disabled={executingTaskId === task.id || task.status === 'completed' || task.status === 'running'}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 disabled:from-gray-100 disabled:to-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-green-600 rounded-xl transition-all text-xs font-medium border border-green-200 disabled:border-gray-200"
                          >
                            {executingTaskId === task.id ? (
                              <Loader className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            {executingTaskId === task.id ? '执行中...' : '开始执行'}
                          </button>
                          <button
                            onClick={() => handleViewTask(task)}
                            disabled={!task.resultSummary && task.status !== 'completed'}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 disabled:from-gray-100 disabled:to-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-blue-600 rounded-xl transition-all text-xs font-medium border border-blue-200 disabled:border-gray-200"
                          >
                            <Eye className="w-3.5 h-3.5" /> 查看
                          </button>
                          <button
                            onClick={() => setDeleteTarget(task)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-600 rounded-xl transition-all text-xs font-medium border border-red-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> 删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#E2E8F0] bg-[#F7F9FC] shrink-0">
            <p className="text-sm text-[#64748B]">
              共 {filteredTasks.length} 条，第 {currentPage}/{totalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-[#415168] border border-gray-200 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> 上一页
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-[#415168] border border-gray-200 transition-colors"
              >
                下一页 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 创建任务弹窗 */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={handleTaskCreated}
        availableUsers={availableUsers}
        dataSources={dataSources}
      />

      {/* 删除确认弹窗 */}
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        taskName={deleteTarget?.taskName || ''}
      />
    </div>
  );
}



