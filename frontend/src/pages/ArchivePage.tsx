import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Search, RefreshCw, Eye, FileText, X,
  ChevronLeft, ChevronRight, Check, User,
  Download, Filter, BarChart3, Clock, AlertTriangle,
  FileStack, Activity, Database, FileText as FileIcon,
  CheckCircle, XCircle, Plus, Info, Trash2, Layers
} from 'lucide-react';
import { fetchDatasets, fetchCSVArchives, fetchHomeStats, uploadArchiveCSV, confirmArchiveImport, type DatasetProfile } from '../api';
import { formatDateTime } from '../utils/dateFormat';

// ==================== 类型定义 ====================

interface ArchiveRecord {
  id: string;
  userId: string;
  dataSource: 'reddit';
  postCount: number;
  riskOverview: '高风险' | '中风险' | '低风险';
  importTime: string;
  lastActive?: string;
  status: 'importing' | 'ready' | 'analyzing';
  userStats?: {
    male: number;
    female: number;
    unknown: number;
  };
}

interface PostRecord {
  id: string;
  userId: string;
  postIndex: number;
  postCount: number;  // 该用户的总帖子数
  content: string;
  sentimentScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  suicideRisk?: number | string; // 原始风险值（用于细粒度标签）
  microExpressions?: string[];
  timestamp?: string;
  hasTimestamp: boolean;
  emjioSequence?: string;
  status: 'pending' | 'accepted' | 'rejected';
  isMissing?: boolean;
  isAnomaly?: boolean;
}

interface ImportStep {
  id: number;
  label: string;
  status: 'active' | 'completed' | 'pending';
}

// ==================== 常量配置 ====================

const DATA_SOURCES = [
  { value: '', label: '全部数据源' },
  { value: 'reddit', label: 'Reddit系列' },
];

const DATA_SOURCE_LABELS: Record<string, string> = {
  reddit: 'Reddit系列',
};

const DATA_SOURCE_COLORS: Record<string, string> = {
  reddit: 'bg-orange-100 text-orange-700',
};

const RISK_COLORS = {
  low: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', badge: 'bg-green-500', light: 'bg-green-50' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', badge: 'bg-yellow-500', light: 'bg-yellow-50' },
  high: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', badge: 'bg-red-500', light: 'bg-red-50' },
};

const RISK_LABELS: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };
void RISK_LABELS;

// ==================== 细粒度风险等级系统（按数据集动态生成）====================
// 详见 .cursor/rules/risk-level-spec.mdc

// 细粒度风险标签映射（根据数据集）- 仅保留 reddit 五分类
const FINE_RISK_LABELS: Record<string, Record<number, string>> = {
  reddit: { 0: '无风险', 1: '极低风险', 2: '低风险', 3: '中风险', 4: '高风险' }, // 五分类
};

// 粗粒度风险等级映射（用于颜色/统一显示）
const COARSE_RISK_MAP: Record<string, Record<number, 'low' | 'medium' | 'high'>> = {
  reddit: { 0: 'low', 1: 'low', 2: 'medium', 3: 'medium', 4: 'high' },
};

// 获取细粒度风险标签（优先使用动态映射，兜底使用静态默认值）
function getFineRiskLabel(riskValue: number | string, dataSource: string, dynamicMap?: Record<string, Record<number, string>>): string {
  const risk = typeof riskValue === 'string' ? parseInt(riskValue) : riskValue;
  const labels = dynamicMap?.[dataSource] ?? FINE_RISK_LABELS[dataSource];
  if (labels && labels[risk] !== undefined) {
    return labels[risk];
  }
  return `风险${risk}`;
}

// 获取粗粒度风险等级（优先使用动态映射，兜底使用静态默认值）
function getCoarseRiskLevel(riskValue: number | string, dataSource: string, dynamicMap?: Record<string, Record<number, 'low' | 'medium' | 'high'>>): 'low' | 'medium' | 'high' {
  const risk = typeof riskValue === 'string' ? parseInt(riskValue) : riskValue;
  const map = dynamicMap?.[dataSource] ?? COARSE_RISK_MAP[dataSource];
  if (map && map[risk] !== undefined) {
    return map[risk];
  }
  return 'medium';
}

// 计算风险分布（按细粒度分类聚合）
function calculateRiskDistribution(records: { suicideRisk?: number | string; riskLevel: 'low' | 'medium' | 'high' }[], dataSource: string, dynamicFineMap?: Record<string, Record<number, string>>): Record<string, number> {
  const distribution: Record<string, number> = {};
  records.forEach(record => {
    const label = getFineRiskLabel(record.suicideRisk ?? record.riskLevel, dataSource, dynamicFineMap);
    distribution[label] = (distribution[label] || 0) + 1;
  });
  return distribution;
}

// ==================== 模拟数据 ====================

// mockPosts（仅用于演示，真实贴文通过 fetchCSVPUserPosts API 获取）
const _mockPosts: PostRecord[] = [
  { id: 'p1', userId: 'user_hash_01', postIndex: 1, postCount: 5, content: '今天又失眠了，感觉生活没有意义。好累啊...', sentimentScore: 0.92, riskLevel: 'high', riskScore: 0.92, timestamp: '2024-03-15 14:30', hasTimestamp: true, microExpressions: ['sad', 'tired', 'despair'], status: 'accepted' },
  { id: 'p2', userId: 'user_hash_01', postIndex: 2, postCount: 5, content: '有时候真的很想就这样结束一切...', sentimentScore: 0.85, riskLevel: 'high', riskScore: 0.85, timestamp: '2024-03-10 20:15', hasTimestamp: true, microExpressions: ['hopeless', 'despair'], status: 'accepted' },
];
void _mockPosts;

// ==================== 导入向导弹窗组件 ====================

function ImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
  dataSourceOptions = DATA_SOURCES,
  dataSourceLabels = DATA_SOURCE_LABELS,
  fineRiskLabels = FINE_RISK_LABELS,
  coarseRiskMap = COARSE_RISK_MAP,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;  // 导入完成回调，通知父组件刷新列表
  dataSourceOptions?: { value: string; label: string }[];
  dataSourceLabels?: Record<string, string>;
  fineRiskLabels?: Record<string, Record<number, string>>;
  coarseRiskMap?: Record<string, Record<number, 'low' | 'medium' | 'high'>>;
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedSource, setSelectedSource] = useState('');
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [importedData, setImportedData] = useState<PostRecord[]>([]);
  const [postStatuses, setPostStatuses] = useState<Record<string, 'pending' | 'accepted' | 'rejected'>>({});
  /** 复选框：仅表示该行是否被选中，与接受/拒绝无关 */
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
  const [isManualAnnotation, setIsManualAnnotation] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  // 保存上传结果，用于步骤2确认导入
  const [uploadResult, setUploadResult] = useState<{
    datasetKey: string;
    filePath: string;
    totalUsers: number;
    totalPosts: number;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [templateType, setTemplateType] = useState<'excel' | 'txt'>('excel');
  const [selectedFields, setSelectedFields] = useState<string[]>(['user_id', 'created_utc', 'post_sequence', 'emjio_sequence', 'suicide_risk']);
  const [_detectedFields, setDetectedFields] = useState<string[]>([]);
  void setDetectedFields; // used in parse logic
  const fileInputRef = useRef<HTMLInputElement>(null);

  const FILE_MAX_SIZE = 20 * 1024 * 1024; // 20M

  // 解析CSV/TXT文件
  const parseCSVFile = async (file: File): Promise<{ data: PostRecord[]; fields: string[]; totalPostCount: number }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split('\n').filter(line => line.trim());
          if (lines.length <= 1) {
            resolve({ data: [], fields: [], totalPostCount: 0 });
            return;
          }

          // 检测分隔符：优先TAB，其次逗号
          const firstLine = lines[0];
          const delimiter = firstLine.includes('\t') ? '\t' : ',';

          // 正确的 CSV 解析函数（处理引号内的逗号）
          const parseCSVLine = (line: string): string[] => {
            const values: string[] = [];
            let current = '';
            let inQuotes = false;
            let quoteChar = '';

            for (let i = 0; i < line.length; i++) {
              const char = line[i];

              if (!inQuotes && (char === '"' || char === "'")) {
                inQuotes = true;
                quoteChar = char;
              } else if (inQuotes && char === quoteChar) {
                // 检查是否是转义引号
                if (line[i + 1] === quoteChar) {
                  current += char;
                  i++; // 跳过下一个引号
                } else {
                  inQuotes = false;
                }
              } else if (!inQuotes && char === delimiter) {
                values.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            values.push(current.trim()); // 最后一个字段
            return values;
          };

          const headers = parseCSVLine(firstLine).map(h => h.toLowerCase());
          const data: PostRecord[] = [];
          let totalPostCount = 0;

          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const getValue = (key: string) => {
              const idx = headers.indexOf(key);
              return idx >= 0 ? values[idx] || '' : '';
            };

            const suicideRisk = getValue('label') || getValue('suicide_risk');
            const parsedRisk = isNaN(parseInt(suicideRisk)) ? suicideRisk : parseInt(suicideRisk);

            // 解析帖子列表（支持 Python list 格式 ['post1', 'post2']）
            // 优先从 post_sequence 列获取帖子列表
            const postStr = getValue('post_sequence') || getValue('post') || getValue('content') || getValue('text') || '';
            const posts = parsePostList(postStr);

            // 解析表情序列（逗号分隔的字符串）
            const emjioStr = getValue('emjio_sequence') || getValue('emoji_sequence') || '';
            const emjioList = emjioStr.split(',').map(e => e.trim()).filter(e => e);

            // 获取用户ID
            const userId = getValue('user') || getValue('user_id') || 'unknown';

            if (posts.length > 0) {
              // 每个帖子创建一条记录
              posts.forEach((postContent: string, postIdx: number) => {
                totalPostCount++;
                // 获取该帖子对应的表情序列（如果有的话）
                const postEmoji = emjioList[postIdx] || emjioList[0] || '';
                data.push({
                  id: `imported_${i}_${postIdx}`,
                  userId: userId,
                  postIndex: postIdx + 1,
                  postCount: posts.length,  // 该用户的总帖子数
                  content: postContent,
                  sentimentScore: parseFloat(getValue('sentiment') || getValue('sentiment_score') || '0.5'),
                  suicideRisk: parsedRisk,
                  riskLevel: parseRiskLevel(suicideRisk),
                  riskScore: parseFloat(getValue('risk_score') || '0.5'),
                  timestamp: getValue('created_utc') || getValue('timestamp') || getValue('time') || undefined,
                  hasTimestamp: !!getValue('created_utc') || !!getValue('timestamp') || !!getValue('time'),
                  emjioSequence: postEmoji,
                  status: 'pending',
                });
              });
            } else {
              // 如果没有帖子内容，仍创建一条记录
              totalPostCount++;
              data.push({
                id: `imported_${i}`,
                userId: userId,
                postIndex: 1,
                postCount: 1,
                content: postStr,
                sentimentScore: parseFloat(getValue('sentiment') || getValue('sentiment_score') || '0.5'),
                suicideRisk: parsedRisk,
                riskLevel: parseRiskLevel(suicideRisk),
                riskScore: parseFloat(getValue('risk_score') || '0.5'),
                timestamp: getValue('created_utc') || getValue('timestamp') || getValue('time') || undefined,
                hasTimestamp: !!getValue('created_utc') || !!getValue('timestamp') || !!getValue('time'),
                emjioSequence: emjioList[0] || '',
                status: 'pending',
              });
            }
          }
          resolve({ data, fields: headers, totalPostCount });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  };

  // 解析帖子列表（支持 Python list 格式和 CSV 转义引号 ""）
  const parsePostList = (postStr: string): string[] => {
    if (!postStr) return [];
    let trimmed = postStr.trim();

    // 如果被双引号包裹（来自CSV解析），移除双引号
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      trimmed = trimmed.slice(1, -1);
    }

    // 检查是否是 Python list 格式 [...]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        // 移除首尾方括号
        const inner = trimmed.slice(1, -1);
        const posts: string[] = [];

        let current = '';
        let inQuote = false;
        let depth = 0;

        for (let i = 0; i < inner.length; i++) {
          const char = inner[i];

          // 处理 CSV 转义的双引号 ""
          if (!inQuote && char === '"' && inner[i + 1] === '"') {
            current += '"';
            i++; // 跳过下一个双引号
            continue;
          }

          if (!inQuote && char === '"') {
            inQuote = true;
          } else if (inQuote && char === '"') {
            // 检查是否是转义的双引号 """
            if (inner[i + 1] === '"') {
              current += '"';
              i++; // 跳过下一个双引号
            } else {
              inQuote = false;
            }
          } else if (!inQuote && char === '[') {
            depth++;
            current += char;
          } else if (!inQuote && char === ']') {
            depth--;
            current += char;
          } else if (!inQuote && char === ',' && depth === 0) {
            const post = current.trim();
            if (post) {
              posts.push(post);
            }
            current = '';
          } else {
            current += char;
          }
        }

        // 处理最后一个帖子
        const lastPost = current.trim();
        if (lastPost) {
          posts.push(lastPost);
        }

        if (posts.length > 0) {
          return posts;
        }
      } catch (err) {
        console.warn('Failed to parse post list:', err);
      }
    }

    // 如果不是列表格式，检查是否包含换行符分隔的多个帖子
    if (trimmed.includes('\n')) {
      const parts = trimmed.split('\n').filter(p => p.trim());
      if (parts.length > 1) {
        return parts;
      }
    }

    return [trimmed];
  };

  // 解析风险等级
  const parseRiskLevel = (value: string): 'low' | 'medium' | 'high' => {
    const v = value.toLowerCase().trim();
    if (v.includes('high') || v.includes('高')) return 'high';
    if (v.includes('low') || v.includes('低')) return 'low';
    return 'medium';
  };

  // 处理文件选择
  const handleFileSelect = async (file: File) => {
    // 文件大小检查
    if (file.size > FILE_MAX_SIZE) {
      setUploadError(`文件大小超过限制（${(file.size / 1024 / 1024).toFixed(2)} MB），最大支持 20MB`);
      return;
    }

    setDataFile(file);
    setUploadError(null);

    // 解析文件内容
    if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
      try {
        const { data: parsedData, fields } = await parseCSVFile(file);
        setDetectedFields(fields);
        if (parsedData.length > 0) {
          setImportedData(parsedData);
          setSelectedRowIds({});
          const statuses: Record<string, 'pending' | 'accepted' | 'rejected'> = {};
          parsedData.forEach(d => { statuses[d.id] = 'pending'; });
          setPostStatuses(statuses);
          // 标记文件已解析
          setDataFileParsed(parsedData);
        } else {
          const mockData = [
            { id: 'imp1', userId: 'new_user_01', postIndex: 1, postCount: 1, content: '测试数据1 - 请检查文件格式', sentimentScore: 0.5, riskLevel: 'medium' as const, riskScore: 0.5, timestamp: new Date().toISOString().split('T')[0], hasTimestamp: true, emjioSequence: '', status: 'pending' as const },
          ];
          setImportedData(mockData);
          setSelectedRowIds({});
          const statuses: Record<string, 'pending' | 'accepted' | 'rejected'> = {};
          mockData.forEach(d => { statuses[d.id] = 'pending'; });
          setPostStatuses(statuses);
          setDataFileParsed(mockData);
        }
      } catch (err) {
        console.error('解析文件失败:', err);
        setUploadError('文件解析失败，请检查文件格式');
      }
    } else {
      setUploadError('暂不支持 .xls/.xlsx 格式，请转换为 CSV 或 TXT 格式上传');
    }
  };

  // 保存已解析的文件数据（用于在 handleImport 中使用）
  const [dataFileParsed, setDataFileParsed] = useState<PostRecord[]>([]);

  // 拖拽处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const validTypes = ['.csv', '.txt', '.xls', '.xlsx'];
      const isValid = validTypes.some(type => file.name.toLowerCase().endsWith(type));
      if (isValid) {
        handleFileSelect(file);
      } else {
        setUploadError('请上传 CSV、TXT 或 Excel 文件');
      }
    }
  };

  // 上传文件到 uploads/archives/ 目录
  const uploadFile = async (file: File, source: string): Promise<{ success: boolean; filePath?: string; data?: any; error?: string }> => {
    try {
      // 调用后端 API 上传文件
      const result = await uploadArchiveCSV(file, source);
      return { success: true, filePath: result.filePath, data: result };
    } catch (err: any) {
      console.error('上传文件失败:', err);
      return { success: false, error: err?.message || '上传失败，请重试' };
    }
  };

  const handleImport = async () => {
    if (!selectedSource || !dataFile) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    // 模拟上传进度
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 200);

    try {
      // 步骤1：上传文件
      const uploadResult = await uploadFile(dataFile, selectedSource);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (uploadResult.success && uploadResult.data) {
        // 跳转到步骤2，使用前端解析的完整数据而不是后端 preview
        // 使用 dataFileParsed（保存的解析结果）而不是 importedData（React状态可能有延迟）
        if (dataFileParsed.length > 0) {
          // 使用前端已解析的完整数据（包含 timestamp, emjioSequence 等所有字段）
          setImportedData([...dataFileParsed]);
        } else {
          // 如果没有前端解析数据，则使用后端 preview（兜底）
          const previewData = uploadResult.data.preview || [];
          const newData = previewData.map((p: any, idx: number) => ({
            id: `imported_${idx}`,
            userId: p.userId,
            postIndex: idx,
            postCount: p.postCount || 1,
            content: p.firstPost || '',
            sentimentScore: 0.5,
            suicideRisk: p.riskValue,
            riskLevel: _getRiskLevel(p.riskValue),
            riskScore: p.riskValue / 4,
            timestamp: undefined,
            hasTimestamp: false,
            emjioSequence: undefined,
            status: 'pending' as const,
            isMissing: false,
            isAnomaly: false,
          }));
          setImportedData(newData);
        }

        // 保存上传结果，用于步骤2确认导入
        setUploadResult({
          datasetKey: uploadResult.data.datasetKey,
          filePath: uploadResult.data.filePath,
          totalUsers: uploadResult.data.totalUsers,
          totalPosts: uploadResult.data.totalPosts,
        });

        // 跳转到步骤2
        setCurrentStep(2);
      } else {
        setUploadError(uploadResult.error || '上传失败');
      }
    } catch (err) {
      clearInterval(progressInterval);
      setUploadError('上传过程出现错误');
    } finally {
      setIsUploading(false);
    }
  };

  // 根据风险值获取粗粒度风险等级
  const _getRiskLevel = (value: number | string): 'low' | 'medium' | 'high' => {
    const v = typeof value === 'string' ? parseInt(value) : value;
    if (v >= 3) return 'high';
    if (v >= 2) return 'medium';
    return 'low';
  };

  /** 批量接受：仅对选中的行生效；若未选任何行则对全部生效，操作后清空复选框 */
  const handleAcceptAll = () => {
    const ids = importedData.filter(d => selectedRowIds[d.id]).map(d => d.id);
    const targetIds = ids.length > 0 ? ids : importedData.map(d => d.id);
    setPostStatuses(prev => {
      const next = { ...prev };
      targetIds.forEach(id => { next[id] = 'accepted'; });
      return next;
    });
    setSelectedRowIds({});
  };

  /** 批量拒绝：仅对选中的行生效；若未选任何行则对全部生效，操作后清空复选框 */
  const handleRejectAll = () => {
    const ids = importedData.filter(d => selectedRowIds[d.id]).map(d => d.id);
    const targetIds = ids.length > 0 ? ids : importedData.map(d => d.id);
    setPostStatuses(prev => {
      const next = { ...prev };
      targetIds.forEach(id => { next[id] = 'rejected'; });
      return next;
    });
    setSelectedRowIds({});
  };

  /** 切换某行是否选中（仅选中状态，与接受/拒绝无关） */
  const toggleRowSelected = (id: string) => {
    setSelectedRowIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  /** 全选/取消全选（仅选中状态） */
  const toggleSelectAll = () => {
    const allSelected = importedData.length > 0 && importedData.every(d => selectedRowIds[d.id]);
    if (allSelected) {
      setSelectedRowIds({});
    } else {
      const next: Record<string, boolean> = {};
      importedData.forEach(d => { next[d.id] = true; });
      setSelectedRowIds(next);
    }
  };

  // 步骤2：确认导入数据到数据库
  const handleConfirmImport = async () => {
    if (!uploadResult) {
      setUploadError('上传结果已过期，请重新上传');
      return;
    }

    setIsConfirming(true);
    setUploadError(null);

    try {
      // 获取被接受的记录（status === 'accepted' 的记录）
      const acceptedRecords = importedData
        .filter(d => postStatuses[d.id] === 'accepted')
        .map(d => d.userId);

      // 如果没有手动接受任何记录，默认全部接受
      const recordsToImport = acceptedRecords.length > 0 ? acceptedRecords : importedData.map(d => d.userId);

      // 调用后端确认导入 API
      const result = await confirmArchiveImport({
        datasetKey: uploadResult.datasetKey,
        filePath: uploadResult.filePath,
        dataSource: selectedSource,
        acceptedRecords: recordsToImport,
        isManualAnnotation,
      });

      if (result.success) {
        // 导入成功，跳转到步骤3
        setCurrentStep(3);
      } else {
        setUploadError(result.message || '导入失败');
      }
    } catch (err: any) {
      console.error('确认导入失败:', err);
      setUploadError(err?.message || '确认导入失败，请重试');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleComplete = () => {
    // 调用回调通知父组件刷新列表
    if (onImportComplete) {
      onImportComplete();
    }
    onClose();
    setCurrentStep(1);
    setSelectedSource('');
    setDataFile(null);
    setImportedData([]);
    setSelectedRowIds({});
    setPostStatuses({});
    setIsManualAnnotation(false);
    setUploadProgress(0);
    setUploadError(null);
    setUploadResult(null);
    setSelectedFields(['user_id', 'created_utc', 'post_sequence', 'emjio_sequence', 'suicide_risk']);
  };

  if (!isOpen) return null;

  const steps: ImportStep[] = [
    { id: 1, label: '上传文件', status: currentStep >= 1 ? (currentStep > 1 ? 'completed' : 'active') : 'pending' },
    { id: 2, label: '检查数据', status: currentStep >= 2 ? (currentStep > 2 ? 'completed' : 'active') : 'pending' },
    { id: 3, label: '完成', status: currentStep >= 3 ? 'active' : 'pending' },
  ];

  // 自动计算用户数（去重user_id数量）
  const uniqueUserCount = new Set(importedData.map(d => d.userId)).size;

  // 根据suicide_risk列的值自动计算细粒度风险等级数
  const uniqueRiskLevels = new Set(importedData.map(d => d.suicideRisk ?? d.riskLevel));
  const fineRiskCount = uniqueRiskLevels.size;

  // 计算细粒度风险分布（使用动态风险映射）
  const riskDistribution = calculateRiskDistribution(importedData, selectedSource, fineRiskLabels);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative bg-[#FAF6F3] rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden animate-scale-in border border-[#EADDD5]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#EADDD5]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#4A362C]">导入心理档案数据</h3>
              <p className="text-xs text-[#8C7A6B]">支持多数据源导入，自动识别风险级别</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#F4EBE1] rounded-xl transition-colors">
            <X className="w-5 h-5 text-[#8C7A6B]" />
          </button>
        </div>

        <div className="flex min-h-[480px]">
          {/* 左侧步骤条 */}
          <div className="w-52 bg-[#F9F5F2] p-5 border-r border-[#EADDD5]">
            <div className="sticky top-5">
              <h4 className="text-xs font-semibold text-[#8C7A6B] uppercase tracking-wider mb-4">导入步骤</h4>
              {steps.map((step) => (
                <div key={step.id} className="flex items-center mb-5 last:mb-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold mr-3 shadow-sm transition-all ${
                    step.status === 'completed' ? 'bg-green-500 text-white' :
                    step.status === 'active' ? 'bg-orange-500 text-white' :
                    'bg-[#EADDD5] text-[#8C7A6B]'
                  }`}>
                    {step.status === 'completed' ? <Check className="w-4 h-4" /> : step.id}
                  </div>
                  <div>
                    <span className={`text-sm font-medium block ${
                      step.status === 'active' ? 'text-[#4A362C]' : step.status === 'completed' ? 'text-green-600' : 'text-[#8C7A6B]'
                    }`}>{step.label}</span>
                    {step.id === 1 && <span className="text-xs text-[#A89B8E]">选择并上传</span>}
                    {step.id === 2 && <span className="text-xs text-[#A89B8E]">审核确认</span>}
                    {step.id === 3 && <span className="text-xs text-[#A89B8E]">完成导入</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧内容 */}
          <div className="flex-1 p-6 overflow-y-auto bg-[#FAF6F3]">
            {currentStep === 1 && (
              <div className="space-y-5">
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-base font-bold text-[#4A362C] flex items-center gap-2">
                      <FileStack className="w-5 h-5 text-[#C19A83]" />
                      步骤 1：上传文件
                    </h4>
                  </div>

                  {/* 下载模板区域 - 包含类型选择和温馨提示 */}
                  <div className="mb-5 p-4 bg-orange-50 rounded-xl border border-orange-100">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-[#5A4B42]">下载模板格式：</span>
                        <div className="flex gap-2">
                          <label className={`flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer transition-all ${
                            templateType === 'excel' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-[#EADDD5] text-[#5A4B42] hover:border-orange-300'
                          }`}>
                            <input type="radio" name="templateType" value="excel" checked={templateType === 'excel'}
                              onChange={() => setTemplateType('excel')} className="sr-only" />
                            <FileText className="w-4 h-4" />
                            <span className="text-sm font-medium">Excel (.xlsx)</span>
                          </label>
                          <label className={`flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer transition-all ${
                            templateType === 'txt' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-[#EADDD5] text-[#5A4B42] hover:border-orange-300'
                          }`}>
                            <input type="radio" name="templateType" value="txt" checked={templateType === 'txt'}
                              onChange={() => setTemplateType('txt')} className="sr-only" />
                            <FileIcon className="w-4 h-4" />
                            <span className="text-sm font-medium">TXT (TAB分隔)</span>
                          </label>
                        </div>
                      </div>
                      <a href={templateType === 'excel' ? '/datasets/archives/导入模板_Excel.csv' : '/datasets/archives/导入模板_TAB.txt'} download
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition-colors shadow-sm">
                        <Download className="w-4 h-4" />
                        下载{templateType === 'excel' ? 'Excel' : 'TXT'}模板
                      </a>
                    </div>
                    <div className="mt-3 flex items-start gap-2">
                      <Info className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-orange-700 mb-0.5">温馨提示</p>
                        <p className="text-xs text-orange-600 leading-relaxed">
                          请{templateType === 'excel' ? '下载 Excel 模板' : '下载 TXT 模板'}，按照格式要求填写数据后再上传。
                          字段说明：user_id（用户ID）、created_utc（时间戳）、post_sequence（贴文序列）、emjio_sequence（微表情序列）、suicide_risk（自杀风险）。
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 数据源选择 */}
                  <div className="mb-5">
                    <label className="block text-sm font-semibold text-[#5A4B42] mb-3">选择数据源 <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-2 gap-3">
                      {dataSourceOptions.slice(1).map((source) => (
                        <label key={source.value} className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer transition-all ${
                          selectedSource === source.value ? 'border-orange-500 bg-orange-50 shadow-sm' : 'border-[#EADDD5] hover:border-orange-300 bg-white'
                        }`}>
                          <input type="radio" name="source" value={source.value} checked={selectedSource === source.value}
                            onChange={(e) => setSelectedSource(e.target.value)} className="sr-only" />
                          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            selectedSource === source.value ? 'bg-orange-500' : 'bg-[#D7BFA6]'
                          }`}></span>
                          <span className="text-sm font-medium text-[#5A4B42]">{source.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 文件上传 */}
                  <div>
                    <label className="block text-sm font-semibold text-[#5A4B42] mb-3">上传数据文件 <span className="text-red-500">*</span></label>
                    <div 
                      className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                        isDragOver ? 'border-orange-400 bg-orange-50' :
                        dataFile ? 'border-green-400 bg-green-50' : 'border-[#D7BFA6] hover:border-orange-400 hover:bg-orange-50'
                      }`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {dataFile ? (
                        <div className="flex items-center justify-center gap-3">
                          <FileText className="w-10 h-10 text-green-500" />
                          <div className="text-left">
                            <p className="font-semibold text-[#4A362C]">{dataFile.name}</p>
                            <p className="text-sm text-[#8C7A6B]">{(dataFile.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setDataFile(null); setImportedData([]); }} className="ml-4 p-1 hover:bg-green-100 rounded-lg">
                            <X className="w-4 h-4 text-green-600" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 text-[#C19A83] mx-auto mb-3" />
                          <p className="text-[#5A4B42] font-medium mb-1">拖拽文件到此处 或 点击选择文件</p>
                          <p className="text-xs text-[#A89B8E]">支持格式：.csv / .txt / .xls / .xlsx，不超过 20M</p>
                        </>
                      )}
                      <input 
                        ref={fileInputRef}
                        type="file" 
                        className="hidden" 
                        accept=".csv,.txt,.xls,.xlsx" 
                        onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} 
                      />
                    </div>
                  </div>

                  {/* 上传进度 */}
                  {isUploading && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-[#5A4B42]">正在上传...</span>
                        <span className="text-sm font-medium text-orange-500">{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-orange-400 to-orange-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {/* 错误提示 */}
                  {uploadError && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-600 flex items-center gap-2">
                        <XCircle className="w-4 h-4" />
                        {uploadError}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-5">
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm">
                  <h4 className="text-base font-bold text-[#4A362C] flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-[#C19A83]" />
                    步骤 2：检查数据
                  </h4>
                  <p className="text-sm text-[#8C7A6B] mb-4">上传完毕后自动解析并展示统计信息与逐条数据，请仔细检查并筛选。</p>

                  {/* 统计信息 */}
                  <div className="bg-gradient-to-r from-[#F9F5F2] to-[#FDF9F6] rounded-xl p-4 mb-5 border border-[#EADDD5]">
                    <h5 className="font-semibold text-sm text-[#4A362C] mb-3 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[#C19A83]" />
                      数据集统计信息
                    </h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">数据来源</p>
                        <p className="font-bold text-[#4A362C]">{dataSourceLabels[selectedSource] || '-'}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">用户数 <span className="text-green-500 text-[10px]">(自动)</span></p>
                        <p className="font-bold text-[#4A362C]">{uniqueUserCount}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">帖子数 <span className="text-green-500 text-[10px]">(自动)</span></p>
                        <p className="font-bold text-[#4A362C]">{importedData.length}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">风险分布 <span className="text-green-500 text-[10px]">(自动)</span></p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(riskDistribution).map(([label, count]) => {
                            const coarseLevel = getCoarseRiskLevel(label, selectedSource, coarseRiskMap);
                            const colorClass = coarseLevel === 'high' ? 'text-red-600' : coarseLevel === 'medium' ? 'text-yellow-600' : 'text-green-600';
                            return (
                              <span key={label} className={`text-xs font-medium ${colorClass}`}>
                                {label}: {count}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">细粒度风险等级 <span className="text-green-500 text-[10px]">(自动)</span></p>
                        <p className="font-bold text-[#4A362C]">{fineRiskCount}分类</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-[#EADDD5]">
                        <p className="text-xs text-[#8C7A6B]">是否手工标注 <span className="text-orange-500 text-[10px]">(人工填写)</span></p>
                        <label className="flex items-center gap-2 mt-1">
                          <input 
                            type="checkbox" 
                            checked={isManualAnnotation}
                            onChange={(e) => setIsManualAnnotation(e.target.checked)}
                            className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500"
                          />
                          <span className="text-xs text-[#5A4B42]">{isManualAnnotation ? '是' : '否'}</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* 字段筛选区域 */}
                  <div className="bg-white rounded-xl p-4 mb-5 border border-[#EADDD5]">
                    <h5 className="font-semibold text-sm text-[#4A362C] mb-3 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#C19A83]" />
                      字段筛选
                    </h5>
                    <p className="text-xs text-[#8C7A6B] mb-3">勾选要显示的字段（user_id、post_sequence、suicide_risk 必选，其他可选）</p>
                    <div className="flex flex-wrap gap-3">
                      {['user_id', 'post_sequence', 'created_utc', 'emjio_sequence', 'suicide_risk'].map(field => {
                        const isRequired = ['user_id', 'post_sequence', 'suicide_risk'].includes(field);
                        const isChecked = selectedFields.includes(field);
                        return (
                          <label key={field} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                            isRequired ? 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-70' :
                            isChecked ? 'bg-orange-50 border-orange-300' : 'bg-white border-[#EADDD5] hover:border-orange-300'
                          }`}>
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              disabled={isRequired}
                              onChange={() => {
                                if (isRequired) return;
                                setSelectedFields(prev => 
                                  prev.includes(field) 
                                    ? prev.filter(f => f !== field)
                                    : [...prev, field]
                                );
                              }}
                              className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500"
                            />
                            <span className="text-xs font-medium text-[#5A4B42]">
                              {field === 'user_id' && '用户ID'}
                              {field === 'post_sequence' && '帖子序号'}
                              {field === 'created_utc' && '时间戳'}
                              {field === 'emjio_sequence' && '表情序列'}
                              {field === 'suicide_risk' && '自杀风险'}
                            </span>
                            {isRequired && <span className="text-[10px] text-gray-400">(必选)</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* 数据检查表格 */}
                  <div className="bg-white border border-[#EADDD5] rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between p-3 bg-gradient-to-r from-[#F9F5F2] to-white border-b border-[#EADDD5]">
                      <h5 className="font-semibold text-sm text-[#4A362C]">数据检查列表 <span className="text-xs font-normal text-[#8C7A6B]">（共 {importedData.length} 条）</span></h5>
                      <div className="flex gap-2">
                        <button
                          onClick={handleAcceptAll}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg text-xs font-medium transition-colors">
                          <CheckCircle className="w-3 h-3" /> 批量接受
                        </button>
                        <button
                          onClick={handleRejectAll}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-medium transition-colors">
                          <XCircle className="w-3 h-3" /> 批量拒绝
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full">
                        <thead className="bg-[#F9F5F2] sticky top-0">
                          <tr>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42] w-10">
                              <input 
                                type="checkbox"
                                checked={importedData.length > 0 && importedData.every(d => selectedRowIds[d.id])}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500 cursor-pointer"
                                title="全选/取消全选"
                              />
                            </th>
                            {selectedFields.includes('user_id') && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">user_id</th>}
                            {selectedFields.includes('created_utc') && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">时间戳</th>}
                            {selectedFields.includes('post_sequence') && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">帖子序列</th>}
                            {selectedFields.includes('emjio_sequence') && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">表情序列</th>}
                            {selectedFields.includes('suicide_risk') && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">风险等级</th>}
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">检查状态</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#5A4B42]">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0EAE5]">
                          {importedData.map((data) => {
                            const rc = RISK_COLORS[data.riskLevel];
                            return (
                              <tr key={data.id} className={`hover:bg-[#FAF6F3] transition-colors ${data.isMissing ? 'bg-orange-50' : data.isAnomaly ? 'bg-red-50' : ''}`}>
                                <td className="px-3 py-2.5">
                                  <input 
                                    type="checkbox"
                                    checked={!!selectedRowIds[data.id]}
                                    onChange={() => toggleRowSelected(data.id)}
                                    className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500 cursor-pointer"
                                    title="选中该行"
                                  />
                                </td>
                                {selectedFields.includes('user_id') && (
                                  <td className="px-3 py-2.5 text-xs text-[#5A4B42] font-mono">{data.userId}</td>
                                )}
                                {selectedFields.includes('created_utc') && (
                                  <td className="px-3 py-2.5 text-xs text-[#5A4B42]">
                                    {data.hasTimestamp ? data.timestamp : <span className="text-orange-400 italic">缺失</span>}
                                  </td>
                                )}
                                {selectedFields.includes('post_sequence') && (
                                  <td className="px-3 py-2.5 text-xs text-[#5A4B42] max-w-[200px] truncate" title={data.content}>
                                    {data.content || <span className="text-gray-300 italic">无内容</span>}
                                  </td>
                                )}
                                {selectedFields.includes('emjio_sequence') && (
                                  <td className="px-3 py-2.5 text-xs text-[#5A4B42] max-w-[120px] truncate">
                                    {data.emjioSequence || <span className="text-gray-300 italic">无</span>}
                                  </td>
                                )}
                                {selectedFields.includes('suicide_risk') && (
                                  <td className="px-3 py-2.5">
                                    <span className={`px-2 py-0.5 ${rc.bg} ${rc.text} text-xs rounded-full font-medium`}>
                                      {getFineRiskLabel(data.suicideRisk ?? data.riskLevel, selectedSource, fineRiskLabels)}
                                    </span>
                                  </td>
                                )}
                                <td className="px-3 py-2.5">
                                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                    postStatuses[data.id] === 'accepted' ? 'bg-green-100 text-green-700' :
                                    postStatuses[data.id] === 'rejected' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {postStatuses[data.id] === 'accepted' ? '已接受' :
                                     postStatuses[data.id] === 'rejected' ? '已拒绝' : '待处理'}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-1">
                                    <button 
                                      onClick={() => setPostStatuses(prev => ({ ...prev, [data.id]: 'accepted' }))}
                                      className={`px-2 py-1 text-xs rounded-lg transition-colors ${
                                        postStatuses[data.id] === 'accepted' 
                                          ? 'bg-green-500 text-white' 
                                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                                      }`}>
                                      接受
                                    </button>
                                    <button 
                                      onClick={() => setPostStatuses(prev => ({ ...prev, [data.id]: 'rejected' }))}
                                      className={`px-2 py-1 text-xs rounded-lg transition-colors ${
                                        postStatuses[data.id] === 'rejected' 
                                          ? 'bg-red-500 text-white' 
                                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                                      }`}>
                                      拒绝
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="flex flex-col items-center justify-center h-full py-12">
                <div className="w-24 h-24 bg-gradient-to-br from-green-100 to-green-200 rounded-full flex items-center justify-center mb-6 shadow-lg">
                  <CheckCircle className="w-14 h-14 text-green-500" />
                </div>
                <h4 className="text-2xl font-bold text-[#4A362C] mb-3">导入完成！</h4>
                <p className="text-[#8C7A6B] mb-2 text-center">
                  已成功导入 <span className="font-bold text-green-600">{importedData.filter(d => postStatuses[d.id] === 'accepted').length}</span> 条数据
                </p>
                <p className="text-sm text-[#A89B8E] mb-6">档案已进入心理档案室列表</p>
                
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm w-full max-w-sm">
                  <h5 className="font-semibold text-sm text-[#4A362C] mb-3">导入摘要</h5>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-2 border-b border-[#F0EAE5]">
                      <span className="text-sm text-[#8C7A6B]">数据来源</span>
                      <span className="text-sm font-medium text-[#4A362C]">{dataSourceLabels[selectedSource]}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-[#F0EAE5]">
                      <span className="text-sm text-[#8C7A6B]">接受记录</span>
                      <span className="text-sm font-medium text-green-600">{importedData.filter(d => postStatuses[d.id] === 'accepted').length} 条</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-[#F0EAE5]">
                      <span className="text-sm text-[#8C7A6B]">拒绝记录</span>
                      <span className="text-sm font-medium text-red-600">{importedData.filter(d => postStatuses[d.id] === 'rejected').length} 条</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-[#8C7A6B]">导入时间</span>
                      <span className="text-sm font-medium text-[#4A362C]">{formatDateTime(new Date().toISOString())}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between items-center p-5 bg-white border-t border-[#EADDD5]">
          <button onClick={() => currentStep > 1 && setCurrentStep(s => s - 1)}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-5 py-2.5 text-[#5A4B42] hover:bg-[#F4EBE1] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium">
            <ChevronLeft className="w-4 h-4" /> 上一步
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-5 py-2.5 text-[#8C7A6B] hover:bg-[#F4EBE1] rounded-xl transition-colors font-medium">
              取消
            </button>
            <button onClick={() => {
              if (currentStep === 1) {
                if (selectedSource && dataFile) handleImport();
              } else if (currentStep === 2) {
                handleConfirmImport();
              } else {
                handleComplete();
              }
            }}
              disabled={(currentStep === 1 && (!selectedSource || !dataFile || isUploading)) || (currentStep === 2 && isConfirming)}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-all font-semibold shadow-sm">
              {currentStep === 1 ? (
                isUploading ? (
                  <>上传中... <Activity className="w-4 h-4 animate-spin" /></>
                ) : (
                  <>下一步 <ChevronRight className="w-4 h-4" /></>
                )
              ) : currentStep === 3 ? (
                <>完成 <Check className="w-4 h-4" /></>
              ) : isConfirming ? (
                <>确认中... <Activity className="w-4 h-4 animate-spin" /></>
              ) : (
                <>下一步 <ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面组件 ====================

export default function ArchivePage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ keyword: '', dataSource: '', status: '' });
  const [appliedFilters, setAppliedFilters] = useState({ keyword: '', dataSource: '', status: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedArchives, setSelectedArchives] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isBatchPanelOpen, setIsBatchPanelOpen] = useState(false);

  // 导入完成后刷新列表
  const handleImportComplete = async () => {
    // 刷新数据 - 重新加载档案和统计
    try {
      const allArchives = await loadDatasetArchives('reddit', 500);
      setArchives(allArchives);
      setArchiveStats({
        total: allArchives.length,
        lowRisk: allArchives.filter(a => a.riskOverview?.includes('低风险')).length,
        mediumRisk: allArchives.filter(a => a.riskOverview?.includes('中风险')).length,
        highRisk: allArchives.filter(a => a.riskOverview?.includes('高风险')).length,
        bySource: {},
      });
      const stats = await fetchHomeStats();
      setHomeStats({
        totalArchives: stats.totalArchives ?? stats.totalUsers ?? 0,
        totalPosts: stats.totalPosts ?? 0,
        riskDistribution: stats.riskDistribution ?? { low: { count: 0, percentage: 0 }, medium: { count: 0, percentage: 0 }, high: { count: 0, percentage: 0 } },
      });
    } catch (err) {
      console.warn('刷新数据失败:', err);
    }
  };

  // 动态数据源配置（从 API 加载）
  const [dataSourceOptions, setDataSourceOptions] = useState<{ value: string; label: string }[]>(DATA_SOURCES);
  const [dataSourceLabels, setDataSourceLabels] = useState<Record<string, string>>({ ...DATA_SOURCE_LABELS });
  const [dataSourceColors, setDataSourceColors] = useState<Record<string, string>>({ ...DATA_SOURCE_COLORS });
  // 动态细粒度/粗粒度风险映射（从 API 的 fineLabels / coarseRiskMapping 加载，覆盖静态默认值）
  const [fineRiskLabels, setFineRiskLabels] = useState<Record<string, Record<number, string>>>({ ...FINE_RISK_LABELS });
  const [coarseRiskMap, setCoarseRiskMap] = useState<Record<string, Record<number, 'low' | 'medium' | 'high'>>>({ ...COARSE_RISK_MAP });

  // 演示档案列表（从 demo_archives 表加载，替代静态 mockArchives）
  const [archives, setArchives] = useState<ArchiveRecord[]>([]);
  const [archiveStats, setArchiveStats] = useState<{
    total: number;
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    bySource: Record<string, number>;
  }>({ total: 0, lowRisk: 0, mediumRisk: 0, highRisk: 0, bySource: {} });

  // 辅助函数：加载指定数据集的档案（支持限制数量）
  // 默认限制 reddit 为 500 条，其他数据集默认不限制
  const loadDatasetArchives = async (datasetKey: string, maxRecords?: number) => {
    const allArchives: ArchiveRecord[] = [];
    const pageSize = 100;
    const MAX_CONCURRENT = 4;
    let page = 1;
    let hasMore = true;

    const loadBatch = async (startPage: number, count: number): Promise<{ archives: ArchiveRecord[]; hasMore: boolean }> => {
      const batchPromises: Promise<any>[] = [];
      for (let i = 0; i < count; i++) {
        batchPromises.push(fetchCSVArchives({ datasetKey, page: startPage + i, pageSize }));
      }
      const results = await Promise.allSettled(batchPromises);
      const archives: ArchiveRecord[] = [];
      let totalFetched = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.archives) {
          archives.push(...result.value.archives);
          totalFetched += result.value.archives.length;
        }
      }
      return { archives, hasMore: totalFetched >= count * pageSize };
    };

    while (hasMore) {
      const batchSize = Math.min(MAX_CONCURRENT, 10);
      const { archives: batchArchives, hasMore: batchHasMore } = await loadBatch(page, batchSize);
      if (batchArchives.length > 0) {
        allArchives.push(...batchArchives);
        page += batchSize;
      }
      hasMore = batchHasMore && batchArchives.length > 0;

      // 检查是否达到最大记录数限制
      if (maxRecords && allArchives.length >= maxRecords) {
        return allArchives.slice(0, maxRecords);
      }

      if (page > 200) break;
    }

    return allArchives;
  };

  // 预留函数，后续可能用到

  // 首页统计（用于风险分布，与首页保持口径一致）
  const [homeStats, setHomeStats] = useState<{
    totalArchives: number;
    totalPosts: number;
    riskDistribution: {
      low: { count: number; percentage: number };
      medium: { count: number; percentage: number };
      high: { count: number; percentage: number };
    };
  } | null>(null);

  // 初始化：加载数据集配置和演示档案
  useEffect(() => {
    const loadDatasetConfig = async () => {
      try {
        const datasets = await fetchDatasets();
        if (datasets && datasets.length > 0) {
          // 构建数据源选项（包含 reddit 和自定义数据集）
          const allDatasetOptions = datasets.map((ds: DatasetProfile) => ({
            value: ds.datasetKey,
            label: ds.displayName,
          }));
          
          setDataSourceOptions([
            { value: '', label: '全部数据源' },
            ...allDatasetOptions,
          ]);
          
          const labels: Record<string, string> = {};
          const colors: Record<string, string> = {};
          const dynamicFine: Record<string, Record<number, string>> = {};
          const dynamicCoarse: Record<string, Record<number, 'low' | 'medium' | 'high'>> = {};
          datasets.forEach((ds: DatasetProfile) => {
            labels[ds.datasetKey] = ds.displayName;
            colors[ds.datasetKey] = ds.color || 'bg-orange-100 text-orange-700';
            if (ds.fineLabels) {
              const parsedFine: Record<number, string> = {};
              Object.entries(ds.fineLabels).forEach(([k, v]) => {
                parsedFine[Number(k)] = v as string;
              });
              dynamicFine[ds.datasetKey] = parsedFine;
            }
            if (ds.coarseRiskMapping) {
              dynamicCoarse[ds.datasetKey] = ds.coarseRiskMapping as Record<number, 'low' | 'medium' | 'high'>;
            }
          });
          setDataSourceLabels(labels);
          setDataSourceColors(colors);
          if (Object.keys(dynamicFine).length > 0) setFineRiskLabels(prev => ({ ...prev, ...dynamicFine }));
          if (Object.keys(dynamicCoarse).length > 0) setCoarseRiskMap(prev => ({ ...prev, ...dynamicCoarse }));
        }
      } catch (err) {
        console.warn('加载数据集配置失败，使用默认值:', err);
      }
    };

    // 初始化加载：默认只加载 reddit 数据集的 500 条用户，提升首屏加载速度
    const loadDefaultArchives = async () => {
      try {
        let allArchives: ArchiveRecord[];

        if (appliedFilters.dataSource) {
          // 如果已有数据源筛选，按筛选加载
          allArchives = await loadDatasetArchives(appliedFilters.dataSource);
        } else {
          // 默认只加载 reddit 的 500 条用户
          allArchives = await loadDatasetArchives('reddit', 500);
        }

        setArchives(allArchives);
        setArchiveStats({
          total: allArchives.length,
          lowRisk: allArchives.filter(a => a.riskOverview?.includes('低风险')).length,
          mediumRisk: allArchives.filter(a => a.riskOverview?.includes('中风险')).length,
          highRisk: allArchives.filter(a => a.riskOverview?.includes('高风险')).length,
          bySource: {},
        });
      } catch (err) {
        console.warn('加载档案失败:', err);
      }
    };

    const loadHomeStats = async () => {
      try {
        const stats = await fetchHomeStats();
        setHomeStats({
          totalArchives: stats.totalArchives ?? stats.totalUsers ?? 0,
          totalPosts: stats.totalPosts ?? 0,
          riskDistribution: stats.riskDistribution ?? { low: { count: 0, percentage: 0 }, medium: { count: 0, percentage: 0 }, high: { count: 0, percentage: 0 } },
        });
      } catch (err) {
        console.warn('加载首页统计失败:', err);
      }
    };

    loadDatasetConfig();
    loadDefaultArchives();
    loadHomeStats();
  }, []);

  // 数据源切换时重新加载档案
  useEffect(() => {
    const loadArchivesOnSourceChange = async () => {
      if (archives.length > 0 || appliedFilters.dataSource) {
        try {
          let allArchives: ArchiveRecord[];

          if (appliedFilters.dataSource) {
            // 加载指定数据集的档案
            allArchives = await loadDatasetArchives(appliedFilters.dataSource);
          } else {
            // 默认只加载 reddit 的 500 条用户
            allArchives = await loadDatasetArchives('reddit', 500);
          }

          setArchives(allArchives);
          setArchiveStats({
            total: allArchives.length,
            lowRisk: allArchives.filter(a => a.riskOverview?.includes('低风险')).length,
            mediumRisk: allArchives.filter(a => a.riskOverview?.includes('中风险')).length,
            highRisk: allArchives.filter(a => a.riskOverview?.includes('高风险')).length,
            bySource: {},
          });
        } catch (err) {
          console.warn('加载档案失败:', err);
        }
      }
    };
    loadArchivesOnSourceChange();
  }, [appliedFilters.dataSource]);

  // 筛选并重新加载档案
  const handleFilterAndReload = async () => {
    setAppliedFilters({ ...filters });
    setCurrentPage(1);
    try {
      let allArchives: ArchiveRecord[];

      if (filters.dataSource) {
        // 加载指定数据集的档案
        allArchives = await loadDatasetArchives(filters.dataSource);
      } else {
        // 默认只加载 reddit 的 500 条用户
        allArchives = await loadDatasetArchives('reddit', 500);
      }

      setArchives(allArchives);
      setArchiveStats({
        total: allArchives.length,
        lowRisk: allArchives.filter(a => a.riskOverview?.includes('低风险')).length,
        mediumRisk: allArchives.filter(a => a.riskOverview?.includes('中风险')).length,
        highRisk: allArchives.filter(a => a.riskOverview?.includes('高风险')).length,
        bySource: {},
      });
    } catch (err) {
      console.warn('筛选加载档案失败:', err);
    }
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleFilterAndReload();
    }
  };

  const handleReset = async () => {
    setFilters({ keyword: '', dataSource: '', status: '' });
    setAppliedFilters({ keyword: '', dataSource: '', status: '' });
    setCurrentPage(1);
    // 重置后只加载 reddit 的 500 条用户
    try {
      const allArchives = await loadDatasetArchives('reddit', 500);

      setArchives(allArchives);
      setArchiveStats({
        total: allArchives.length,
        lowRisk: allArchives.filter(a => a.riskOverview?.includes('低风险')).length,
        mediumRisk: allArchives.filter(a => a.riskOverview?.includes('中风险')).length,
        highRisk: allArchives.filter(a => a.riskOverview?.includes('高风险')).length,
        bySource: {},
      });
    } catch (err) {
      console.warn('重置加载档案失败:', err);
    }
  };

  const filteredArchives = archives.filter(archive => {
    if (appliedFilters.keyword && !archive.userId.toLowerCase().includes(appliedFilters.keyword.toLowerCase())) return false;
    if (appliedFilters.dataSource && archive.dataSource !== appliedFilters.dataSource) return false;
    if (appliedFilters.status && archive.status !== appliedFilters.status) return false;
    return true;
  });

  const totalPages = Math.ceil(filteredArchives.length / pageSize);
  const paginatedArchives = filteredArchives.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 统计概览数据（优先取首页口径，确保与分页显示一致）
  // 档案总数：使用首页统计的总数，而非过滤后的数量
  const totalUsers = homeStats?.totalArchives ?? archiveStats.total;
  const totalPosts = homeStats?.totalPosts ?? archives.reduce((sum, a) => sum + a.postCount, 0);
  const highRiskCount = homeStats?.riskDistribution.high.count ?? archiveStats.highRisk;
  const mediumRiskCount = homeStats?.riskDistribution.medium.count ?? archiveStats.mediumRisk;
  const lowRiskCount = homeStats?.riskDistribution.low.count ?? archiveStats.lowRisk;

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-5 animate-fade-in">
      {/* 统计概览卡片 - 统一风格：圆形图标 + 白色卡片 + 主题色背景 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 shrink-0">
        {/* 档案总数 */}
        <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-[#EADDD5]">
          <div className="w-12 h-12 rounded-xl bg-[#C19A83] flex items-center justify-center shadow-sm shrink-0">
            <FileStack className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-[#8C7A6B] whitespace-nowrap">档案总数</span>
            <span className="text-2xl font-bold text-[#4A362C]">{totalUsers}</span>
          </div>
        </div>

        {/* 帖子总数 */}
        <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-[#EADDD5]">
          <div className="w-12 h-12 rounded-xl bg-gray-400 flex items-center justify-center shadow-sm shrink-0">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-[#8C7A6B] whitespace-nowrap">帖子总数</span>
            <span className="text-2xl font-bold text-[#4A362C]">{totalPosts}</span>
          </div>
        </div>

        {/* 风险分布 */}
        <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-[#EADDD5]">
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center shadow-sm shrink-0">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-[#8C7A6B] whitespace-nowrap">风险分布</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-red-500">{highRiskCount}</span>
              <span className="text-lg font-bold text-yellow-600">{mediumRiskCount}</span>
              <span className="text-lg font-bold text-green-500">{lowRiskCount}</span>
            </div>
          </div>
        </div>

        {/* 低风险档案 */}
        <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-[#EADDD5]">
          <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center shadow-sm shrink-0">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-[#8C7A6B] whitespace-nowrap">低风险档案</span>
            <span className="text-2xl font-bold text-[#4A362C]">{lowRiskCount}</span>
          </div>
        </div>

        {/* 高风险档案 - 强调 */}
        <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-red-200">
          <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center shadow-sm shrink-0">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-red-600 whitespace-nowrap">高风险档案</span>
            <span className="text-2xl font-bold text-red-500">{highRiskCount}</span>
          </div>
        </div>
      </div>

      {/* 快捷操作区 - 统一风格：橙色主题按钮 */}
      <div className="shrink-0 bg-white rounded-2xl p-5 shadow-sm border border-[#EADDD5]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-[#5A4B42]">快捷操作：</span>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl text-sm font-medium transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> 导入数据
          </button>
          <button
            onClick={() => { setIsBatchMode(true); setIsBatchPanelOpen(true); }}
            className="flex items-center gap-2 px-5 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] rounded-xl text-sm font-medium transition-colors border border-[#EADDD5]"
          >
            <Layers className="w-4 h-4" /> 批量管理
          </button>
        </div>
      </div>

      {/* 筛选工具栏 - 模仿农业文档风格 */}
      <div className="shrink-0 bg-white rounded-2xl p-5 shadow-sm border border-[#EADDD5]">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#5A4B42]">关键词：</label>
            <input type="text" placeholder="输入用户ID关键词"
              className="px-3 py-2 border border-[#EADDD5] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 text-sm w-40 bg-[#FAF6F3]"
              value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} onKeyDown={handleKeywordKeyDown} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#5A4B42]">数据来源：</label>
            <select className="px-3 py-2 border border-[#EADDD5] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 text-sm bg-[#FAF6F3]"
              value={filters.dataSource} onChange={(e) => setFilters({ ...filters, dataSource: e.target.value })}>
              {dataSourceOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#5A4B42]">状态：</label>
            <select className="px-3 py-2 border border-[#EADDD5] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 text-sm bg-[#FAF6F3]"
              value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">全部状态</option>
              <option value="ready">已就绪</option>
              <option value="importing">导入中</option>
              <option value="analyzing">分析中</option>
            </select>
          </div>
          <button onClick={handleFilterAndReload}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl transition-all text-sm font-medium shadow-sm">
            <Search className="w-4 h-4" /> 筛选
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-2 px-5 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5C4D43] rounded-xl transition-colors text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> 重置
          </button>
          
          {/* 已应用筛选条件提示 */}
          {appliedFilters.keyword || appliedFilters.dataSource || appliedFilters.status ? (
            <div className="flex items-center gap-2 text-sm text-[#8C7A6B] ml-auto">
              <Filter className="w-4 h-4" />
              <span>当前筛选：</span>
              {appliedFilters.keyword && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs">关键词: {appliedFilters.keyword}</span>}
              {appliedFilters.dataSource && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">{dataSourceLabels[appliedFilters.dataSource]}</span>}
              {appliedFilters.status && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">{appliedFilters.status === 'ready' ? '已就绪' : appliedFilters.status === 'importing' ? '导入中' : '分析中'}</span>}
            </div>
          ) : null}
        </div>
      </div>

      {/* 档案列表 */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm border border-[#EADDD5] overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-[#F9F5F2] to-[#FDF9F6] sticky top-0 z-10">
              <tr>
                {isBatchMode && (
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32] w-12">
                    <input
                      type="checkbox"
                      checked={paginatedArchives.length > 0 && paginatedArchives.every(a => selectedArchives.has(a.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedArchives(prev => {
                            const newSet = new Set(prev);
                            paginatedArchives.forEach(a => newSet.add(a.id));
                            return newSet;
                          });
                        } else {
                          setSelectedArchives(prev => {
                            const newSet = new Set(prev);
                            paginatedArchives.forEach(a => newSet.delete(a.id));
                            return newSet;
                          });
                        }
                      }}
                      className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">用户ID</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">数据来源</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">贴文数</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">风险等级</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">导入时间</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#4A3B32]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EAE5]">
              {paginatedArchives.map((archive) => {
                const riskKey = archive.riskOverview === '高风险' ? 'high' : archive.riskOverview === '中风险' ? 'medium' : 'low';
                const isSelected = selectedArchives.has(archive.id);
                return (
                  <tr key={archive.id} className={`hover:bg-[#FAF6F3] transition-colors ${isSelected ? 'bg-orange-50' : ''}`}>
                    {isBatchMode && (
                      <td className="px-4 py-3.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedArchives(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(archive.id)) {
                                newSet.delete(archive.id);
                              } else {
                                newSet.add(archive.id);
                              }
                              return newSet;
                            });
                          }}
                          className="w-4 h-4 rounded border-[#D7BFA6] text-orange-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-50 to-rose-100 flex items-center justify-center">
                          <User className="w-5 h-5 text-rose-400" />
                        </div>
                        <span className="text-sm font-medium text-[#4A3B32]">{archive.userId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-3 py-1 ${dataSourceColors[archive.dataSource] || 'bg-gray-100 text-gray-700'} text-xs rounded-full font-medium`}>
                        {dataSourceLabels[archive.dataSource] || archive.dataSource}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#A89B8E]" />
                        <span className="text-sm text-[#5A4B42]">{archive.postCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${riskKey === 'high' ? 'bg-red-500' : riskKey === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`}></span>
                        <span className={`px-3 py-1 ${RISK_COLORS[riskKey].bg} ${RISK_COLORS[riskKey].text} text-xs rounded-full font-medium`}>
                          {archive.riskOverview}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 text-sm text-[#8C7A6B]">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDateTime(archive.importTime)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => {
                          sessionStorage.setItem('selectedArchive', JSON.stringify(archive));
                          navigate(`/archive/detail/${archive.id}`);
                        }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 text-blue-600 rounded-xl transition-all text-sm font-medium border border-blue-200">
                          <Eye className="w-4 h-4" /> 查看
                        </button>
                        <button onClick={() => {
                          const confirmed = window.confirm(`确定要删除档案「${archive.userId}」吗？此操作不可恢复。`);
                          if (confirmed) {
                            // 模拟删除：从列表中移除
                            // 实际项目中应调用 API 删除
                            console.log('删除档案:', archive.id);
                          }
                        }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-600 rounded-xl transition-all text-sm font-medium border border-red-200">
                          <Trash2 className="w-4 h-4" /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 批量操作面板 */}
        {isBatchMode && isBatchPanelOpen && (
          <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-orange-50 to-orange-100 border-t border-orange-200">
            <div className="flex items-center gap-4">
              <span className="text-sm text-[#5A4B42]">
                已选择 <strong className="text-orange-600">{selectedArchives.size}</strong> 项
              </span>
              <button
                onClick={() => { setSelectedArchives(new Set()); setIsBatchMode(false); setIsBatchPanelOpen(false); }}
                className="text-sm text-[#8C7A6B] hover:text-[#5A4B42] transition-colors"
              >
                取消选择
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const confirmed = window.confirm(`确定要删除选中的 ${selectedArchives.size} 条档案吗？`);
                  if (confirmed) {
                    // 模拟删除
                    setSelectedArchives(new Set());
                    setIsBatchMode(false);
                    setIsBatchPanelOpen(false);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-xl text-sm font-medium transition-all shadow-sm"
              >
                <Trash2 className="w-4 h-4" /> 批量删除
              </button>
              <button
                onClick={() => { setIsBatchMode(false); setIsBatchPanelOpen(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5C4D43] rounded-xl text-sm font-medium transition-colors"
              >
                <X className="w-4 h-4" /> 关闭
              </button>
            </div>
          </div>
        )}

        {/* 分页 - 模仿农业文档风格 */}
        <div className="shrink-0 flex items-center justify-between p-4 border-t border-[#EADDD5] bg-gradient-to-r from-[#F9F5F2] to-white">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#8C7A6B]">每页显示：</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="px-3 py-1.5 border border-[#EADDD5] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300">
              <option value="10">10条</option>
              <option value="20">20条</option>
              <option value="50">50条</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#8C7A6B]">共 <strong className="text-[#4A362C]">{filteredArchives.length}</strong> 条，第 <strong className="text-[#4A362C]">{currentPage}</strong>/<strong className="text-[#4A362C]">{totalPages || 1}</strong> 页</span>
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="p-2 hover:bg-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4 text-[#5A4B42]" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-3 py-1.5 bg-white border border-[#EADDD5] rounded-lg text-sm hover:bg-[#F4EBE1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                上一页
              </button>
              <span className="px-4 py-1.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg text-sm font-semibold shadow-sm">
                {currentPage}
              </span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-white border border-[#EADDD5] rounded-lg text-sm hover:bg-[#F4EBE1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                下一页
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="p-2 hover:bg-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4 text-[#5A4B42]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      <ImportWizardModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        dataSourceOptions={dataSourceOptions}
        dataSourceLabels={dataSourceLabels}
        fineRiskLabels={fineRiskLabels}
        coarseRiskMap={coarseRiskMap}
      />
    </div>
  );
}
