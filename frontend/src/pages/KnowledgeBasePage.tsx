import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  Upload,
  FileText,
  Eye,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  FilePlus,
  Activity,
  Loader,
  Edit,
  Database,
  FolderTree,
  Tags,
} from 'lucide-react';
import { formatDateTimeShort } from '../utils/dateFormat';
import {
  fetchKnowledgeTopics,
  fetchKnowledgeSubTopics,
  fetchKnowledgeKeywords,
  fetchKnowledgeDocuments,
  uploadKnowledgeDocument,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  updateKnowledgeDocument,
  type KnowledgeTopic,
  type KnowledgeSubTopic,
  type KnowledgeDocument as ApiKnowledgeDocument,
} from '../api';
import { useAuthStore } from '../store/authStore';
import PaperStatCard from '../components/PaperStatCard';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

// ==================== 类型定义 ====================

type KnowledgeDoc = ApiKnowledgeDocument;

// ==================== 默认配置（API 不可用时的兜底，与 rag-skill/knowledge 目录结构对齐）====================

// 主标题：与 rag-skill/knowledge 目录结构完全对应
const DEFAULT_TOPICS = [
  { value: '', label: '全部主题' },
  { value: '1', label: '自杀与自伤' },
  { value: '2', label: '抑郁' },
  { value: '3', label: '焦虑' },
  { value: '4', label: '危机干预' },
  { value: '5', label: '情绪' },
  { value: '6', label: '睡眠与生理' },
  { value: '7', label: '量表与筛查' },
  { value: '8', label: '干预与求助资源' },
  { value: '9', label: '心理健康素养' },
];

// 子标题：与 rag-skill/knowledge 目录的子目录结构对齐
const DEFAULT_SUB_TOPICS: Record<string, { value: string; label: string }[]> = {
  '': [{ value: '', label: '全部子主题' }],
  // 主题1：自杀与自伤
  '1': [
    { value: '', label: '全部子主题' },
    { value: '自杀预防与教育', label: '自杀预防与教育' },
    { value: '自伤与自残', label: '自伤与自残' },
    { value: '危机表达与手段', label: '危机表达与手段' },
    { value: '求助与转介', label: '求助与转介' },
  ],
  // 主题2：抑郁
  '2': [
    { value: '', label: '全部子主题' },
    { value: '抑郁症状与评估', label: '抑郁症状与评估' },
    { value: '抑郁与自杀风险', label: '抑郁与自杀风险' },
    { value: '治疗与药物', label: '治疗与药物' },
    { value: '量表说明', label: '量表说明' },
  ],
  // 主题3：焦虑
  '3': [
    { value: '', label: '全部子主题' },
    { value: '广泛性焦虑与识别', label: '广泛性焦虑与识别' },
    { value: '焦虑与睡眠', label: '焦虑与睡眠' },
    { value: '应对策略', label: '应对策略' },
  ],
  // 主题4：危机干预
  '4': [
    { value: '', label: '全部子主题' },
    { value: '热线与即时求助', label: '热线与即时求助' },
    { value: '现场干预要点', label: '现场干预要点' },
    { value: '事后干预与随访', label: '事后干预与随访' },
  ],
  // 主题5：情绪
  '5': [
    { value: '', label: '全部子主题' },
    { value: '情绪识别与表达', label: '情绪识别与表达' },
    { value: '负面情绪与风险', label: '负面情绪与风险' },
    { value: '情绪调节', label: '情绪调节' },
  ],
  // 主题6：睡眠与生理
  '6': [
    { value: '', label: '全部子主题' },
    { value: '失眠与心理', label: '失眠与心理' },
    { value: '安眠药与副作用', label: '安眠药与副作用' },
    { value: '生理指标与睡眠', label: '生理指标与睡眠' },
  ],
  // 主题7：量表与筛查
  '7': [
    { value: '', label: '全部子主题' },
    { value: 'PHQ-9说明与解读', label: 'PHQ-9说明与解读' },
    { value: 'SAS_SDS_MINI等', label: 'SAS_SDS_MINI等' },
    { value: 'C-SSRS等危机量表', label: 'C-SSRS等危机量表' },
  ],
  // 主题8：干预与求助资源
  '8': [
    { value: '', label: '全部子主题' },
    { value: '心理机构与医院', label: '心理机构与医院' },
    { value: '心理援助热线', label: '心理援助热线' },
    { value: '公益与社区资源', label: '公益与社区资源' },
  ],
  // 主题9：心理健康素养
  '9': [
    { value: '', label: '全部子主题' },
    { value: '心理健康标准', label: '心理健康标准' },
    { value: '认知扭曲与CBT', label: '认知扭曲与CBT' },
    { value: '情绪调节策略', label: '情绪调节策略' },
    { value: '心理健康问题与应对', label: '心理健康问题与应对' },
  ],
};

const DEFAULT_KEYWORDS = [
  '高危信号', '预警', '遗书', '轻生', '求助', '失眠', '自伤', '抑郁', '焦虑', '危机', '干预', '自杀', '绝望', '情绪', '压力', '睡眠', '心理', '治疗', '药物', '筛查'
];

const MAX_FILTER_KEYWORDS = 36;

// 仅拦截明显的 mojibake / 替换字符，避免误伤 PHQ-9、GAD-7 这类正常关键词。
function isLikelyGarbledKeyword(keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return true;

  // Unicode replacement char
  if (trimmed.includes('\uFFFD')) return true;

  // 常见 UTF-8/Latin-1 误解码痕迹，如 "Ã¥", "æŠ‘" 一类。
  const mojibakePattern = /[ÃÂÅÆÇÐÑØÞßãæçðñøþÿ]/;
  if (mojibakePattern.test(trimmed)) return true;

  return false;
}

// ==================== 工具函数：获取 topic/subtopic 名称 ====================

// 缓存 topic/subtopic ID -> name 映射（从 API 加载后填充）
let topicIdToName: Record<string, string> = {};
let subTopicIdToName: Record<string, string> = {};

function getTopicName(topicId: string | number | undefined): string {
  if (!topicId && topicId !== 0) return '';
  // 确保使用字符串键查询，因为映射的键都是字符串
  const key = String(topicId);
  return topicIdToName[key] || key;
}

function getSubTopicName(subTopicId: string | number | undefined): string {
  if (!subTopicId && subTopicId !== 0) return '';
  // 确保使用字符串键查询，因为映射的键都是字符串
  const key = String(subTopicId);
  return subTopicIdToName[key] || key;
}

function getKeywords(doc: KnowledgeDoc): string[] {
  if (!doc.keywords) return [];
  if (Array.isArray(doc.keywords)) return doc.keywords;
  if (typeof doc.keywords === 'string') {
    try { return JSON.parse(doc.keywords); } catch { return []; }
  }
  return [];
}

function getSizeDisplay(doc: KnowledgeDoc): string {
  return doc.sizeDisplay || (doc.fileSize ? `${(doc.fileSize / 1024 / 1024).toFixed(1)} MB` : '-');
}

function getUploadTime(doc: KnowledgeDoc): string {
  const uploaded = formatDateTimeShort(doc.uploadedAt || '');
  if (uploaded !== '-') return uploaded;
  return formatDateTimeShort(doc.createdAt || '');
}

// ==================== 文档上传弹窗 ====================
function UploadModal({
  isOpen,
  onClose,
  onSuccess,
  topics = DEFAULT_TOPICS,
  subTopicsMap = DEFAULT_SUB_TOPICS,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  topics?: { value: string; label: string }[];
  subTopicsMap?: Record<string, { value: string; label: string }[]>;
}) {
  const [formData, setFormData] = useState({
    title: '',
    topic: '',
    subTopic: '',
    keywords: '',
    description: '',
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setFormData({ title: '', topic: '', subTopic: '', keywords: '', description: '' });
    setSelectedFile(null);
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError(null);
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setUploadError(null);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (['.pdf', '.doc', '.docx', '.txt', '.md', '.markdown'].some(t => file.name.toLowerCase().endsWith(t))) {
        handleFileSelect(file);
      } else {
        setUploadError('请上传 PDF、DOCX、TXT 或 Markdown 文件');
      }
    }
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) { setUploadError('请输入文档标题'); return; }
    if (!formData.topic) { setUploadError('请选择主题'); return; }
    if (!selectedFile) { setUploadError('请选择要上传的文件'); return; }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    const progressInterval = setInterval(() => {
      setUploadProgress(prev => { if (prev >= 90) { clearInterval(progressInterval); return prev; } return prev + 10; });
    }, 200);

    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('title', formData.title);
      fd.append('topic_id', String(formData.topic));
      if (formData.subTopic) fd.append('sub_topic_id', String(formData.subTopic));
      if (formData.keywords.trim()) fd.append('keywords', formData.keywords);
      if (formData.description.trim()) fd.append('summary', formData.description);

      const result = await uploadKnowledgeDocument(fd);
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (result.success) {
        setTimeout(() => { onSuccess?.(); onClose(); }, 500);
      } else {
        setUploadError(result.message || '上传失败');
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setUploadError(err.message || '上传过程出现错误');
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-scale-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-[#162033]">上传知识文档</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">文档标题 *</label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              placeholder="请输入文档标题"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#162033] mb-2">主题 *</label>
              <select
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value, subTopic: '' })}
              >
                {topics.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#162033] mb-2">子主题 *</label>
              <select
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
                value={formData.subTopic}
                onChange={(e) => setFormData({ ...formData, subTopic: e.target.value })}
                disabled={!formData.topic}
              >
                {subTopicsMap[formData.topic]?.map((st) => (
                  <option key={st.value} value={st.value}>{st.label}</option>
                )) || <option value="">请先选择主题</option>}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">关键词（用逗号分隔）</label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              placeholder="如：高危信号、预警、遗书"
              value={formData.keywords}
              onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">文档描述</label>
            <textarea
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              rows={3}
              placeholder="请输入文档简要描述"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">文件上传 *</label>
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                isDragOver ? 'border-blue-500 bg-blue-50' :
                selectedFile ? 'border-green-400 bg-green-50' :
                'border-gray-300 hover:border-blue-500 hover:bg-blue-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="w-8 h-8 text-green-500" />
                  <div className="text-left">
                    <p className="font-semibold text-[#162033]">{selectedFile.name}</p>
                    <p className="text-sm text-[#64748B]">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} className="ml-4 p-1 hover:bg-green-100 rounded-lg">
                    <X className="w-4 h-4 text-green-600" />
                  </button>
                </div>
              ) : (
                <>
                  <FilePlus className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">点击或拖拽上传</p>
                  <p className="text-xs text-gray-400 mt-1">支持 PDF、DOCX、TXT、MD</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.markdown"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
          </div>

          {isUploading && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[#415168]">正在上传...</span>
                <span className="text-sm font-medium text-blue-600">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-600 flex items-center gap-2">
                <X className="w-4 h-4" />
                {uploadError}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
          <ActionCapsuleButton onClick={onClose} disabled={isUploading} variant="neutral" size="lg">
            取消
          </ActionCapsuleButton>
          <ActionCapsuleButton
            onClick={handleSubmit}
            disabled={isUploading}
            variant="solid"
            size="lg"
            icon={isUploading ? <Activity className="w-4 h-4 animate-spin" /> : undefined}
          >
            {isUploading ? '上传中...' : '上传文档'}
          </ActionCapsuleButton>
        </div>
      </div>
    </div>
  );
}

// ==================== 文档编辑弹窗 ====================
function EditModal({
  isOpen,
  onClose,
  onSuccess,
  document,
  topics = DEFAULT_TOPICS,
  subTopicsMap = DEFAULT_SUB_TOPICS,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  document: ApiKnowledgeDocument | null;
  topics?: { value: string; label: string }[];
  subTopicsMap?: Record<string, { value: string; label: string }[]>;
}) {
  const [formData, setFormData] = useState({
    title: '',
    topic: '',
    subTopic: '',
    keywords: '',
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = () => {
    if (document) {
      const docKeywords = getKeywords(document);
      setFormData({
        title: document.title || '',
        topic: document.topicId ? String(document.topicId) : '',
        subTopic: document.subTopicId ? String(document.subTopicId) : '',
        keywords: docKeywords.join('、'),
        description: document.description || '',
      });
    } else {
      setFormData({ title: '', topic: '', subTopic: '', keywords: '', description: '' });
    }
    setSaveError(null);
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, document]);

  const handleSubmit = async () => {
    if (!formData.title.trim()) { setSaveError('请输入文档标题'); return; }
    if (!formData.topic) { setSaveError('请选择主题'); return; }
    if (!document) { setSaveError('未指定要编辑的文档'); return; }

    setIsSaving(true);
    setSaveError(null);

    try {
      const result = await updateKnowledgeDocument(Number(document.id), {
        title: formData.title.trim(),
        topic_id: Number(formData.topic),
        sub_topic_id: formData.subTopic ? Number(formData.subTopic) : undefined,
        keywords: formData.keywords.trim(),
        summary: formData.description.trim(),
      });

      if (result.success) {
        setTimeout(() => { onSuccess?.(); onClose(); }, 500);
      } else {
        setSaveError(result.message || '更新失败');
      }
    } catch (err: any) {
      setSaveError(err.message || '更新过程出现错误');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-scale-in">
        <div className="flex items-center justify-between p-6 border-b border-[#E2E8F0]">
          <h3 className="text-xl font-bold text-[#162033]">编辑知识文档</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">文档标题 *</label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              placeholder="请输入文档标题"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#162033] mb-2">主题 *</label>
              <select
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value, subTopic: '' })}
              >
                {topics.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#162033] mb-2">子主题</label>
              <select
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
                value={formData.subTopic}
                onChange={(e) => setFormData({ ...formData, subTopic: e.target.value })}
                disabled={!formData.topic}
              >
                {subTopicsMap[formData.topic]?.map((st) => (
                  <option key={st.value} value={st.value}>{st.label}</option>
                )) || <option value="">请先选择主题</option>}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">关键词（用逗号分隔）</label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              placeholder="如：高危信号、预警、遗书"
              value={formData.keywords}
              onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#162033] mb-2">文档描述</label>
            <textarea
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent"
              rows={3}
              placeholder="请输入文档简要描述"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          {saveError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-600 flex items-center gap-2">
                <X className="w-4 h-4" />
                {saveError}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
          <ActionCapsuleButton onClick={onClose} disabled={isSaving} variant="neutral" size="lg">
            取消
          </ActionCapsuleButton>
          <ActionCapsuleButton
            onClick={handleSubmit}
            disabled={isSaving}
            variant="solid"
            size="lg"
            icon={isSaving ? <Activity className="w-4 h-4 animate-spin" /> : undefined}
          >
            {isSaving ? '保存中...' : '保存修改'}
          </ActionCapsuleButton>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面组件 ====================

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  // 筛选表单状态（用户选择的条件）
  const [filters, setFilters] = useState({
    topic: '',
    subTopic: '',
    status: '',
    format: '',
  });

  // 已应用的筛选条件（点击「筛选」按钮后才生效）
  const [appliedFilters, setAppliedFilters] = useState({
    topic: '',
    subTopic: '',
    status: '',
    format: '',
  });

  // 关键词选择
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [appliedKeywords, setAppliedKeywords] = useState<string[]>([]);

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 弹窗
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<KnowledgeDoc | null>(null);

  // 动态主题/子主题/关键词（从 API 加载）
  const [topics, setTopics] = useState<{ value: string; label: string }[]>(DEFAULT_TOPICS);
  const [subTopicsMap, setSubTopicsMap] = useState<Record<string, { value: string; label: string }[]>>(DEFAULT_SUB_TOPICS);
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);

  // 文档列表数据（从 API 加载）
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [uploadedTotal, setUploadedTotal] = useState(0);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  // 配置加载完成标志（用于确保 loadDocuments 在 loadConfig 完成后执行，避免 topicIdToName 未填充导致显示数字 ID）
  const [configLoaded, setConfigLoaded] = useState(false);

  // 加载主题、子主题、关键词配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [topicsRes, subTopicsRes, keywordsRes] = await Promise.all([
          fetchKnowledgeTopics(),
          fetchKnowledgeSubTopics(),
          fetchKnowledgeKeywords(),
        ]);

        // 构建 ID -> name 映射
        const tIdToName: Record<string, string> = {};
        const stIdToName: Record<string, string> = {};

        if (topicsRes && topicsRes.topics && topicsRes.topics.length > 0) {
          topicsRes.topics.forEach((t: KnowledgeTopic) => { tIdToName[String(t.id)] = t.topicName; });

          const dynamicTopics: { value: string; label: string }[] = [
            { value: '', label: '全部主题' },
            ...topicsRes.topics.map((t: KnowledgeTopic) => ({ value: String(t.id), label: t.topicName })),
          ];
          setTopics(dynamicTopics);

          // 按 topicId 分组子主题
          const grouped = new Map<number, KnowledgeSubTopic[]>();
          subTopicsRes.forEach((st: KnowledgeSubTopic) => {
            stIdToName[String(st.id)] = st.subTopicName;
            if (!grouped.has(st.topicId)) grouped.set(st.topicId, []);
            grouped.get(st.topicId)!.push(st);
          });

          const dynamicSubTopics: Record<string, { value: string; label: string }[]> = { '': [{ value: '', label: '全部子主题' }] };
          grouped.forEach((items, topicId) => {
            dynamicSubTopics[String(topicId)] = [
              { value: '', label: '全部子主题' },
              ...items.map((st: KnowledgeSubTopic) => ({ value: String(st.id), label: st.subTopicName })),
            ];
          });
          setSubTopicsMap(dynamicSubTopics);

          topicIdToName = tIdToName;
          subTopicIdToName = stIdToName;
          setConfigLoaded(true); // 标记配置加载完成，loadDocuments 现在可以安全执行
        } else {
          // 即使没有从 API 加载到主题数据，也标记为已加载（使用默认映射）
          setConfigLoaded(true);
        }

        if (keywordsRes && keywordsRes.length > 0) {
          console.log('[DEBUG] 关键词原始数据:', JSON.stringify(keywordsRes.slice(0, 3))); // 只打印前3个调试
          // 检测是否有乱码
          const apiKeywords = keywordsRes.map((k: any) => k.keyword);
          const hasGarbled = apiKeywords.some((kw: string) => isLikelyGarbledKeyword(kw));
          if (hasGarbled) {
            console.warn('[WARN] API 返回的关键词存在编码问题，使用默认关键词');
            setKeywords(DEFAULT_KEYWORDS);
          } else {
            setKeywords(apiKeywords);
          }
        } else {
          // API 没有返回数据，使用默认关键词
          console.log('[INFO] API 未返回关键词，使用默认关键词');
          setKeywords(DEFAULT_KEYWORDS);
        }
      } catch (err) {
        console.warn('加载知识库配置失败，使用默认值:', err);
        setKeywords(DEFAULT_KEYWORDS);
        setConfigLoaded(true); // 出错时也标记为已加载，使用默认映射
      }
    };
    loadConfig();
  }, []);

  // 从 API 加载文档列表（依赖于 configLoaded，确保主题/子主题映射已加载）
  const loadDocuments = async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const topicId = appliedFilters.topic ? Number(appliedFilters.topic) : undefined;
      const subTopicId = appliedFilters.subTopic ? Number(appliedFilters.subTopic) : undefined;
      const [data, uploadedData] = await Promise.all([
        fetchKnowledgeDocuments({
          page: currentPage,
          limit: pageSize,
          topicId,
          subTopicId,
          status: appliedFilters.status || undefined,
          format: appliedFilters.format || undefined,
        }),
        fetchKnowledgeDocuments({
          page: 1,
          limit: 1,
          status: 'uploaded',
        }),
      ]);
      setDocuments(data.documents || []);
      setTotalDocs(data.pagination?.total || 0);
      setUploadedTotal(uploadedData.pagination?.total || 0);
    } catch (err) {
      console.error('加载文档列表失败:', err);
      setDocsError('加载文档列表失败，请检查网络连接');
      setDocuments([]);
      setUploadedTotal(0);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => { loadDocuments(); }, [currentPage, pageSize, appliedFilters.topic, appliedFilters.subTopic, appliedFilters.status, appliedFilters.format, configLoaded]);

  // 筛选表单变更
  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'topic') next.subTopic = '';
      return next;
    });
  };

  const handleKeywordToggle = (keyword: string) => {
    setSelectedKeywords(prev => prev.includes(keyword) ? prev.filter(k => k !== keyword) : [...prev, keyword]);
  };

  const handleApplyFilter = () => {
    setAppliedFilters({ ...filters });
    setAppliedKeywords([...selectedKeywords]);
    setCurrentPage(1);
  };

  const handleReset = () => {
    setFilters({ topic: '', subTopic: '', status: '', format: '' });
    setSelectedKeywords([]);
    setAppliedFilters({ topic: '', subTopic: '', status: '', format: '' });
    setAppliedKeywords([]);
    setCurrentPage(1);
  };

  const openEditModal = (doc: KnowledgeDoc) => {
    setEditingDoc(doc);
    setIsEditModalOpen(true);
  };

  // 对 API 返回的文档进行前端关键词过滤（API 不支持关键词过滤，只能前端做）
  const filteredDocs = documents.filter(doc => {
    if (appliedKeywords.length > 0) {
      const docKeywords = getKeywords(doc);
      if (!appliedKeywords.some(kw => docKeywords.includes(kw))) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(totalDocs / pageSize);
  const visibleKeywords = keywords.slice(0, MAX_FILTER_KEYWORDS);
  const hiddenKeywordCount = Math.max(0, keywords.length - visibleKeywords.length);
  const knowledgeStats = [
    {
      label: '知识文档',
      value: totalDocs,
      note: '当前知识库纳入检索与问答增强的文档总量',
      icon: Database,
      tone: 'blue' as const,
    },
    {
      label: '主题结构',
      value: Math.max(0, topics.length - 1),
      note: '按主题与子主题组织危机识别、干预与量表知识',
      icon: FolderTree,
      tone: 'cyan' as const,
    },
    {
      label: '已上传文档',
      value: uploadedTotal,
      note: '全库中已完成入库处理并可直接参与检索的文档总数',
      icon: Upload,
      tone: 'green' as const,
    },
    {
      label: '可筛选关键词',
      value: keywords.length,
      note: hiddenKeywordCount > 0
        ? `当前展示 ${visibleKeywords.length} 个高优先级关键词，另收起 ${hiddenKeywordCount} 个低优先级关键词`
        : '当前用于主题检索与快速筛选的关键词总数',
      icon: Tags,
      tone: 'slate' as const,
    },
  ];

  const getFormatBadge = (format: string) => {
    const config: Record<string, { bg: string; text: string }> = {
      pdf: { bg: 'bg-red-100', text: 'text-red-700' },
      docx: { bg: 'bg-blue-100', text: 'text-blue-700' },
      md: { bg: 'bg-green-100', text: 'text-green-700' },
      txt: { bg: 'bg-gray-100', text: 'text-gray-700' },
    };
    const c = config[format] || config.txt;
    return <span className={`px-2 py-1 ${c.bg} ${c.text} text-xs rounded-full uppercase font-medium`}>{format}</span>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'uploaded': return <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">已上传</span>;
      case 'uploading': return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full">上传中</span>;
      case 'failed': return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">上传失败</span>;
      default: return null;
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-6 animate-fade-in">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {knowledgeStats.map((stat) => (
          <PaperStatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            note={stat.note}
            icon={stat.icon}
            tone={stat.tone}
          />
        ))}
      </div>

      {/* 筛选工具栏 */}
      <div className="shrink-0 bg-white rounded-[28px] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0]">
        <div className="flex flex-wrap gap-4">
          {/* 主题筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">主题：</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 text-sm bg-[#F7F9FC] min-w-[140px]"
              value={filters.topic}
              onChange={(e) => handleFilterChange('topic', e.target.value)}
            >
              {topics.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* 子主题筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">子主题：</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 text-sm bg-[#F7F9FC] min-w-[140px]"
              value={filters.subTopic}
              onChange={(e) => handleFilterChange('subTopic', e.target.value)}
              disabled={!filters.topic}
            >
              {subTopicsMap[filters.topic]?.map((st) => <option key={st.value} value={st.value}>{st.label}</option>) || <option value="">全部子主题</option>}
            </select>
          </div>

          {/* 状态筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">状态：</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 text-sm bg-[#F7F9FC]"
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="uploading">上传中</option>
              <option value="uploaded">已上传</option>
              <option value="failed">上传失败</option>
            </select>
          </div>

          {/* 格式筛选 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[#415168] whitespace-nowrap">格式：</label>
            <select
              className="px-3 py-2 border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 text-sm bg-[#F7F9FC]"
              value={filters.format}
              onChange={(e) => handleFilterChange('format', e.target.value)}
            >
              <option value="">全部格式</option>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
              <option value="md">Markdown</option>
              <option value="txt">TXT</option>
            </select>
          </div>
        </div>

        {/* 关键词筛选 */}
        <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-medium text-[#415168] whitespace-nowrap">关键词：</span>
            {visibleKeywords.map((kw) => (
              <button
                key={kw}
                onClick={() => handleKeywordToggle(kw)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  selectedKeywords.includes(kw)
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#F7F9FC] text-[#415168] hover:bg-blue-50 hover:text-blue-700 border border-[#E2E8F0]'
                }`}
              >
                {kw}
              </button>
            ))}
            {hiddenKeywordCount > 0 && (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]">
                已收起 {hiddenKeywordCount} 个低优先级关键词
              </span>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex items-center gap-3">
          <ActionCapsuleButton
            onClick={handleApplyFilter}
            variant="solid"
            icon={<Search className="w-4 h-4" />}
          >
            筛选
          </ActionCapsuleButton>
          <ActionCapsuleButton
            onClick={handleReset}
            variant="neutral"
            icon={<RefreshCw className="w-4 h-4" />}
          >
            重置
          </ActionCapsuleButton>
          {isAdmin && (
            <div className="flex items-center gap-2 ml-auto">
              <ActionCapsuleButton
                onClick={() => setIsUploadModalOpen(true)}
                title="上传文档（管理员）"
                variant="solid"
                icon={<Upload className="w-4 h-4" />}
              >
                上传文档
              </ActionCapsuleButton>
            </div>
          )}
        </div>
      </div>

      {/* 文档列表 */}
      <div className="flex-1 min-h-0 bg-white rounded-[28px] shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[#E8EEF6] bg-[#FCFDFF] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#162033]">知识文档列表</h2>
            <p className="mt-1 text-sm text-[#6B7B8F]">文档详情、关键词覆盖与下载操作统一在此处完成。</p>
          </div>
        </div>
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-[#F7FAFD] to-white sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">标题</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">主题</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">子主题</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">关键词</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">格式</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">大小</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">状态</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">上传时间</th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-[#334155]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAF0F6]">
              {docsLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[#94A3B8]">
                    <Loader className="w-8 h-8 text-[#2F6BFF] mx-auto mb-3 animate-spin" />
                    <p>加载中...</p>
                  </td>
                </tr>
              ) : docsError ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-red-500">
                    <p>{docsError}</p>
                    <button onClick={loadDocuments} className="mt-2 text-sm text-blue-600 underline">重试</button>
                  </td>
                </tr>
              ) : filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#94A3B8]">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="w-12 h-12 text-[#BFD3F2]" />
                      <p>暂无文档</p>
                      <p className="text-sm">点击上方「上传文档」按钮添加知识库文档</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[#F7F9FC] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium text-[#162033]">{doc.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#415168]">{doc.topic?.topicName || getTopicName(doc.topicId)}</td>
                    <td className="px-4 py-3 text-sm text-[#415168]">{doc.subTopic?.subTopicName || getSubTopicName(doc.subTopicId) || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {getKeywords(doc).slice(0, 3).map((kw, i) => (
                          <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{kw}</span>
                        ))}
                        {getKeywords(doc).length > 3 && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">+{getKeywords(doc).length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{getFormatBadge(doc.format)}</td>
                    <td className="px-4 py-3 text-sm text-[#415168]">{getSizeDisplay(doc)}</td>
                    <td className="px-4 py-3">{getStatusBadge(doc.uploadStatus)}</td>
                    <td className="px-4 py-3 text-sm text-[#415168]">{getUploadTime(doc)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <ActionCapsuleButton
                          onClick={() => navigate(`/knowledge/detail?id=${String(doc.id)}`)}
                          title="查看详情"
                          tone="blue"
                          tableAction
                          icon={<Eye className="w-4 h-4" />}
                        >
                          查看
                        </ActionCapsuleButton>
                        <ActionCapsuleButton
                          onClick={() => downloadKnowledgeDocument(Number(doc.id), doc.fileName)}
                          title="下载"
                          tone="green"
                          tableAction
                          icon={<Download className="w-4 h-4" />}
                        >
                          下载
                        </ActionCapsuleButton>
                        {isAdmin && (
                          <ActionCapsuleButton
                            onClick={() => openEditModal(doc)}
                            title="编辑（管理员）"
                            tone="amber"
                            tableAction
                            icon={<Edit className="w-4 h-4" />}
                          >
                            编辑
                          </ActionCapsuleButton>
                        )}
                        {isAdmin && (
                          <ActionCapsuleButton
                            onClick={async () => {
                              if (confirm(`确定要删除文档「${doc.title}」吗？此操作不可恢复。`)) {
                                try {
                                  await deleteKnowledgeDocument(Number(doc.id));
                                  loadDocuments();
                                } catch (err) {
                                  alert('删除失败: ' + (err instanceof Error ? err.message : '未知错误'));
                                }
                              }
                            }}
                            title="删除（管理员）"
                            tone="red"
                            tableAction
                            icon={<Trash2 className="w-4 h-4" />}
                          >
                            删除
                          </ActionCapsuleButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控件 */}
        <div className="shrink-0 flex items-center justify-between p-4 border-t border-[#E2E8F0] bg-gradient-to-r from-[#F7FAFD] to-white">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#64748B]">每页显示：</span>
            <select
              className="px-3 py-1.5 border border-[#E2E8F0] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            >
              <option value="10">10条</option>
              <option value="20">20条</option>
              <option value="50">50条</option>
              <option value="100">100条</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[#64748B]">
              共 <strong className="text-[#162033]">{totalDocs}</strong> 条，第 <strong className="text-[#162033]">{currentPage}</strong> / <strong className="text-[#162033]">{totalPages || 1}</strong> 页
            </span>
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="p-2 hover:bg-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4 text-[#415168]" />
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-sm hover:bg-[#F1F5FA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                上一页
              </button>
              <span className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm">{currentPage}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0}
                className="px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-sm hover:bg-[#F1F5FA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                下一页
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalPages === 0}
                className="p-2 hover:bg-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4 text-[#415168]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 上传弹窗 */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={loadDocuments}
        topics={topics}
        subTopicsMap={subTopicsMap}
      />

      {/* 编辑弹窗 */}
      <EditModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setEditingDoc(null); }}
        onSuccess={loadDocuments}
        document={editingDoc}
        topics={topics}
        subTopicsMap={subTopicsMap}
      />
    </div>
  );
}



