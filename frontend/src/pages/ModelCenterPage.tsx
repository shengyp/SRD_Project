import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Settings, Server, Cloud, Plus, Edit, Trash2, Eye, X, FileCode, ChevronLeft,
  ChevronRight, CheckCircle2, AlertCircle, Bot, Brain, KeyRound, Shield,
} from 'lucide-react';
import { formatDateTime, formatDate } from '../utils/dateFormat';
import {
  fetchModels, fetchPromptTemplates,
  createPromptTemplate, updatePromptTemplate, deletePromptTemplate,
  createModel, updateModel, deleteModel, updateModelApiKey,
  type PromptTemplate,
} from '../api';
import type { UnifiedModel } from '../types';

// ==================== API Key 配置弹窗 ====================
function ApiKeyConfigModal({
  isOpen, onClose, model, onSuccess,
}: {
  isOpen: boolean; onClose: () => void;
  model?: UnifiedModel | null; onSuccess?: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) { setApiKey(''); setError(null); }
  }, [isOpen]);

  if (!isOpen || !model) return null;

  const providerLabel: Record<string, string> = {
    dashscope: '通义千问（DashScope）',
    hunyuan: '腾讯云混元',
    openai: 'OpenAI',
    zhipu: '智谱 GLM',
    deepseek: 'DeepSeek',
    moonshot: 'Kimi（月之暗面）',
    google: 'Gemini（Google）',
  };

  const docLinks: Record<string, string> = {
    dashscope: 'https://help.aliyun.com/zh/dashscope/',
    hunyuan: 'https://cloud.tencent.com/document/product/',
    openai: 'https://platform.openai.com/api-keys',
    zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    moonshot: 'https://platform.moonshot.cn/console/api-keys',
    google: 'https://aistudio.google.com/app/apikey',
  };

  const label = providerLabel[model.provider || ''] || model.provider || 'API';

  const handleSubmit = async () => {
    if (!apiKey.trim()) { setError('请输入 API Key'); return; }
    setSaving(true); setError(null);
    try {
      await updateModelApiKey(model.id, apiKey.trim());
      onSuccess?.(); onClose();
    } catch (err: any) {
      setError(err?.message || err?.detail || '配置失败，请重试');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black bg-opacity-40 pointer-events-auto" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg m-4 animate-scale-in border border-[#EADDD5]">
        <div className="flex items-center justify-between p-6 border-b border-[#EADDD5]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#4A3B32]">配置 API Key</h3>
              <p className="text-xs text-[#8C7A6B]">{model.modelName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
              <div className="text-sm text-orange-700">
                <p className="font-medium mb-1">此模型需要配置 API Key 才能使用</p>
                <p className="text-orange-600 text-xs">请到 <strong>{label}</strong> 官网申请 API Key，并在下方填写。</p>
                {docLinks[model.provider || ''] && (
                  <a href={docLinks[model.provider || '']} target="_blank" rel="noopener noreferrer"
                    className="mt-1 inline-block text-orange-600 underline text-xs hover:text-orange-800">
                    获取 API Key →
                  </a>
                )}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#4A3B32] mb-2">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... 或对应的 API Key"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none text-sm font-mono"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-[#8C7A6B]">API Key 将安全存储，不会明文显示在日志中</p>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[#EADDD5] bg-[#FAF6F3]">
          <button onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] text-sm font-medium transition-colors border border-[#EADDD5]">
            取消
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-sm font-medium transition-all shadow-sm disabled:opacity-50">
            {saving ? '保存中...' : '确认配置'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 确认删除弹窗 ====================
function ConfirmModal({
  isOpen, onClose, onConfirm, title, message, confirmText = '确认', loading = false,
}: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmText?: string; loading?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 animate-scale-in overflow-hidden border border-[#EADDD5]">
        <div className="p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 border border-red-200">
            <Trash2 className="w-7 h-7 text-red-500" />
          </div>
          <h3 className="text-xl font-bold text-[#4A3B32] mb-2">{title}</h3>
          <p className="text-sm text-[#8C7A6B]">{message}</p>
        </div>
        <div className="flex border-t border-[#EADDD5]">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-medium text-[#5A4B42] hover:bg-[#FAF6F3] transition-colors border-r border-[#EADDD5]">
            取消
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-3 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50">
            {loading ? '删除中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 添加/编辑模型弹窗 ====================
function AddModelModal({
  isOpen, onClose, editData, onSuccess,
}: {
  isOpen: boolean; onClose: () => void;
  editData?: UnifiedModel | null; onSuccess?: () => void;
}) {
  const [modelType, setModelType] = useState<'api' | 'local'>('api');
  const [localModelSubType, setLocalModelSubType] = useState<'llm' | 'detection'>('llm');
  const [detectionModelType, setDetectionModelType] = useState<'emoji'>('emoji');
  const [llmDeployType] = useState<'ollama' | 'transformers'>('ollama');
  const [formData, setFormData] = useState({
    modelName: '', description: '', apiKey: '', baseUrl: '',
    provider: '', configTemplate: '', ollamaModelName: '', modelPath: '', enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (editData) {
      const m = editData as any;
      setFormData({
        modelName: m.modelName || m.name || '',
        description: m.description || '',
        apiKey: m.apiKey || m.api_key || '',
        baseUrl: m.apiBaseUrl || m.api_base_url || '',
        provider: m.provider || '',
        configTemplate: m.configTemplate || '',
        ollamaModelName: m.ollamaModelName || m.ollama_model_name || '',
        modelPath: m.modelPath || m.model_path || m.modelFilePath || '',
        enabled: m.status === 'active',
      });
      if ('provider' in m && m.provider) {
        setModelType('api');
      } else {
        setModelType('local');
        const path = m.modelPath || m.model_path || '';
        if (path.includes('emoji') || (m.modelType && m.modelType === 'emoji')) {
          setLocalModelSubType('detection'); setDetectionModelType('emoji');
        } else {
          setLocalModelSubType('llm');
        }
      }
    } else {
      setFormData({ modelName: '', description: '', apiKey: '', baseUrl: '', provider: '', configTemplate: '', ollamaModelName: '', modelPath: '', enabled: true });
      setModelType('api'); setLocalModelSubType('llm'); setDetectionModelType('emoji');
    }
    setSaveError(null);
  }, [editData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.modelName.trim()) { setSaveError('请输入模型名称'); return; }
    setSaving(true); setSaveError(null);
    try {
      const payload: any = {
        modelName: formData.modelName, description: formData.description,
        isAvailable: formData.enabled, status: formData.enabled ? 'active' : 'inactive',
      };
      if (modelType === 'api') {
        Object.assign(payload, {
          modelType: 'api', modelCategory: 'api',
          apiKey: formData.apiKey, apiBaseUrl: formData.baseUrl,
          provider: formData.provider,
          configTemplate: formData.configTemplate || undefined,
        });
      } else {
        if (localModelSubType === 'llm') {
          Object.assign(payload, {
            modelType: llmDeployType, modelCategory: 'local_llm',
            ollamaBaseUrl: 'http://localhost:11434',
            ollamaModelName: formData.ollamaModelName,
            description: formData.description,
          });
        } else {
          Object.assign(payload, {
            modelType: detectionModelType, modelCategory: 'detection',
            detectionType: detectionModelType,
            modelPath: formData.modelPath, description: formData.description,
          });
        }
      }
      if (editData?.id) { await updateModel(editData.id, payload); }
      else { await createModel(payload); }
      onSuccess?.(); onClose();
    } catch (err: any) {
      setSaveError(err?.message || err?.detail || '保存失败，请重试');
    } finally { setSaving(false); }
  };

  // Provider 配置
  const providerLabel: Record<string, string> = {
    dashscope: '通义千问（DashScope）',
    hunyuan: '腾讯云混元',
    openai: 'OpenAI',
    zhipu: '智谱 GLM',
    deepseek: 'DeepSeek',
    moonshot: 'Kimi（月之暗面）',
    google: 'Gemini（Google）',
  };

  const docLinks: Record<string, string> = {
    dashscope: 'https://help.aliyun.com/zh/dashscope/',
    hunyuan: 'https://cloud.tencent.com/document/product/',
    openai: 'https://platform.openai.com/api-keys',
    zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    moonshot: 'https://platform.moonshot.cn/console/api-keys',
    google: 'https://aistudio.google.com/app/apikey',
  };

  // 检查当前编辑的模型是否需要配置 API Key
  const isApiModelEditing = modelType === 'api' && !!editData?.id;
  const needsApiKeyHint = isApiModelEditing && editData?.modelCategory === 'api' && !editData?.hasApiKey;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-scale-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-[#4A3B32]">{editData ? '编辑模型' : '添加模型'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-6 space-y-5">
          {/* API Key 未配置提示 */}
          {needsApiKeyHint && (
            <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                <div className="text-sm text-orange-700">
                  <p className="font-medium mb-1">此模型需要配置 API Key 才能使用</p>
                  <p className="text-orange-600 text-xs">请在下方填写 API Key，或到 {providerLabel[formData.provider] || formData.provider} 官网申请。</p>
                  {docLinks[formData.provider] && (
                    <a href={docLinks[formData.provider]} target="_blank" rel="noopener noreferrer"
                      className="mt-1 inline-block text-orange-600 underline text-xs hover:text-orange-800">
                      获取 API Key →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-[#4A3B32] mb-2">模型类型</label>
            <div className="flex gap-3">
              <label className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${modelType === 'api' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="mt" checked={modelType === 'api'} onChange={() => setModelType('api')} className="w-4 h-4 text-orange-500" />
                <Cloud className="w-4 h-4 text-gray-500" /><span className="font-medium text-sm">API 模型</span>
              </label>
              <label className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${modelType === 'local' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="mt" checked={modelType === 'local'} onChange={() => setModelType('local')} className="w-4 h-4 text-orange-500" />
                <Server className="w-4 h-4 text-gray-500" /><span className="font-medium text-sm">本地模型</span>
              </label>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">模型名称 <span className="text-red-500">*</span></label>
              <input type="text" value={formData.modelName} onChange={(e) => setFormData({...formData, modelName: e.target.value})} placeholder="请输入模型名称"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition-all text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">模型描述</label>
              <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="请输入模型描述（可选）" rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none transition-all text-sm resize-none" />
            </div>
            {modelType === 'api' ? (
              <div className="space-y-3 pl-3 border-l-2 border-orange-100">
                <div>
                  <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">配置模板</label>
                    <select value={formData.configTemplate} onChange={(e) => setFormData({...formData, configTemplate: e.target.value})}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm bg-white">
                    <option value="">自定义</option>
                    <option value="openai">OpenAI</option>
                    <option value="zhipu">智谱 GLM</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="dashscope">通义千问</option>
                    <option value="moonshot">Kimi（月之暗面）</option>
                    <option value="google">Gemini（Google）</option>
                    <option value="hunyuan">腾讯云混元</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">Base URL</label>
                  <input type="text" value={formData.baseUrl} onChange={(e) => setFormData({...formData, baseUrl: e.target.value})} placeholder="https://api.example.com/v1"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">API Key</label>
                  <input type="password" value={formData.apiKey} onChange={(e) => setFormData({...formData, apiKey: e.target.value})} placeholder="sk-..."
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">API 提供商</label>
                  <input type="text" value={formData.provider} onChange={(e) => setFormData({...formData, provider: e.target.value})} placeholder="例如：OpenAI、通义千问"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm" />
                </div>
              </div>
            ) : (
              <div className="space-y-3 pl-3 border-l-2 border-orange-100">
                <div>
                  <label className="block text-sm font-semibold text-[#4A3B32] mb-2">本地模型类型</label>
                  <div className="flex gap-3">
                    <label className={`flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all ${localModelSubType === 'llm' ? 'border-orange-400 bg-orange-50' : 'border-gray-200'}`}>
                      <input type="radio" name="lmt" checked={localModelSubType === 'llm'} onChange={() => setLocalModelSubType('llm')} className="w-4 h-4 text-orange-500" />
                      <Bot className="w-4 h-4 text-gray-500" /><span className="text-sm font-medium">LLM</span>
                    </label>
                    <label className={`flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all ${localModelSubType === 'detection' ? 'border-orange-400 bg-orange-50' : 'border-gray-200'}`}>
                      <input type="radio" name="lmt" checked={localModelSubType === 'detection'} onChange={() => setLocalModelSubType('detection')} className="w-4 h-4 text-orange-500" />
                      <Brain className="w-4 h-4 text-gray-500" /><span className="text-sm font-medium">检测模型</span>
                    </label>
                  </div>
                </div>
                {localModelSubType === 'llm' && (
                  <div className="space-y-3 pl-3 border-l-2 border-orange-100">
                    <div>
                      <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">Ollama 模型名称</label>
                      <input type="text" value={formData.ollamaModelName} onChange={(e) => setFormData({...formData, ollamaModelName: e.target.value})}
                        placeholder="如 llama2:7b-chat"
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">服务地址</label>
                      <input type="text" value="http://localhost:11434" readOnly
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-400" />
                    </div>
                  </div>
                )}
                {localModelSubType === 'detection' && (
                  <div className="space-y-3 pl-3 border-l-2 border-orange-100">
                    <div>
                      <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">模型类型</label>
                      <select value={detectionModelType} onChange={(e) => setDetectionModelType(e.target.value as 'emoji')}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 focus:outline-none text-sm bg-white">
                        <option value="emoji">情绪表情模型</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">模型路径（.pkl / .onnx）</label>
                      <input type="text" value={formData.modelPath} onChange={(e) => setFormData({...formData, modelPath: e.target.value})}
                        placeholder="/models/emoji_model/reddit.pkl"
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 focus:outline-none text-sm" />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formData.enabled} onChange={(e) => setFormData({...formData, enabled: e.target.checked})} className="w-4 h-4 text-orange-500 rounded" />
                <span className="text-sm font-medium text-[#4A3B32]">启用</span>
              </label>
            </div>
          </div>
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{saveError}</div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm disabled:opacity-50">
            {saving ? '保存中...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 创建/编辑指令模板弹窗 ====================
function TemplateModal({
  isOpen, onClose, editData, onSuccess,
}: {
  isOpen: boolean; onClose: () => void; editData?: PromptTemplate | null; onSuccess?: () => void;
}) {
  const [formData, setFormData] = useState({ name: '', taskType: '', description: '', promptContent: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (editData) {
      setFormData({
        name: editData.name || '',
        taskType: editData.taskType || '',
        description: editData.description || '',
        promptContent: (editData as any).promptContent || (editData as any).content || '',
        remarks: '',
      });
    } else {
      setFormData({ name: '', taskType: '', description: '', promptContent: '', remarks: '' });
    }
    setSaveError(null);
  }, [editData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) { setSaveError('请输入模板名称'); return; }
    if (!formData.taskType) { setSaveError('请选择任务类型'); return; }
    if (!formData.promptContent.trim()) { setSaveError('请输入提示词内容'); return; }
    setSaving(true); setSaveError(null);
    try {
      const payload = {
        name: formData.name, taskType: formData.taskType,
        description: formData.description, promptContent: formData.promptContent,
        isActive: true,
      };
      if (editData?.id) { await updatePromptTemplate(editData.id, payload); }
      else { await createPromptTemplate(payload as any); }
      onSuccess?.(); onClose();
    } catch (err: any) {
      setSaveError(err?.message || err?.detail || '保存失败，请重试');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-scale-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-[#4A3B32]">{editData ? '编辑指令模板' : '创建指令模板'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">模板名称 <span className="text-red-500">*</span></label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="请输入模板名称"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">任务类型 <span className="text-red-500">*</span></label>
            <select value={formData.taskType} onChange={(e) => setFormData({...formData, taskType: e.target.value})}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm bg-white">
              <option value="">请选择任务类型</option>
              <option value="自杀风险检测">自杀风险检测</option><option value="抑郁筛查">抑郁筛查</option>
              <option value="焦虑检测">焦虑检测</option><option value="压力评估">压力评估</option>
              <option value="综合评估">综合评估</option><option value="其他">其他</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">检测类型/说明</label>
            <input type="text" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="如：文本风险检测、多模态联合检测等"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A3B32] mb-1.5">提示词内容 <span className="text-red-500">*</span></label>
            <textarea value={formData.promptContent} onChange={(e) => setFormData({...formData, promptContent: e.target.value})}
              placeholder="支持变量占位符如 &#123;&#123;user_input&#125;&#125;、&#123;&#123;context&#125;&#125;，用于调用大模型时的 system/user 模板"
              rows={7}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-orange-400 outline-none text-sm resize-none font-mono" />
          </div>
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{saveError}</div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 查看指令模板详情弹窗 ====================
function TemplateDetailModal({
  isOpen, onClose, template,
}: {
  isOpen: boolean; onClose: () => void; template?: PromptTemplate | null;
}) {
  if (!isOpen || !template) return null;
  const tpl = template as any;
  const content = tpl.promptContent || tpl.content || '';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-40" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4 animate-scale-in border border-[#EADDD5]">
        <div className="flex items-center justify-between p-5 border-b border-[#EADDD5] shrink-0">
          <h3 className="text-lg font-bold text-[#4A3B32]">模板详情</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[#8C7A6B]">模板名称</label>
            <p className="font-semibold text-[#4A3B32]">{template.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[#8C7A6B]">任务类型</label>
            <span className="px-2.5 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-lg">{template.taskType}</span>
          </div>
          {template.description && (
            <div>
              <label className="block text-sm font-medium text-[#8C7A6B] mb-1">说明</label>
              <p className="text-sm text-[#5C4D43]">{template.description}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-[#8C7A6B] mb-1">提示词内容</label>
            <div className="bg-[#F9F5F2] rounded-xl p-4 border border-[#EADDD5] max-h-64 overflow-y-auto custom-scrollbar">
              <pre className="whitespace-pre-wrap text-[#5C4D43] text-sm font-mono leading-relaxed">{content}</pre>
            </div>
          </div>
          {template.usageCount !== undefined && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-[#8C7A6B]">使用次数</label>
              <p className="text-sm text-[#5C4D43]">{template.usageCount}</p>
            </div>
          )}
          {template.createdAt && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-[#8C7A6B]">创建时间</label>
              <p className="text-sm text-[#5C4D43]">{formatDateTime(template.createdAt)}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end p-4 border-t border-[#EADDD5] shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] text-sm font-medium transition-colors border border-[#EADDD5]">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 查看模型详情弹窗 ====================
function ModelDetailModal({
  isOpen, onClose, model,
}: {
  isOpen: boolean; onClose: () => void; model?: UnifiedModel | null;
}) {
  if (!isOpen || !model) return null;
  const m = model;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black bg-opacity-40 pointer-events-auto" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-scale-in border border-[#EADDD5]">
        <div className="flex items-center justify-between p-6 border-b border-[#EADDD5]">
          <h3 className="text-xl font-bold text-[#4A3B32]">模型详情</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">模型名称</span><span className="font-semibold text-[#4A3B32]">{m.modelName}</span></div>
          <div className="flex items-center gap-3">
            <span className="text-[#8C7A6B] font-medium w-20">类型</span>
            {m.modelType === 'emoji'
              ? <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">Emocc 情绪检测</span>
              : m.modelCategory === 'api'
              ? <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">API 模型</span>
              : <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded text-xs font-medium">本地 LLM</span>}
          </div>
          {m.isBuiltin && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">预置</span>
              <span className="px-2 py-0.5 bg-teal-50 border border-teal-200 text-teal-600 rounded text-xs font-medium">系统预置模型，禁止删除</span>
            </div>
          )}
          {m.provider && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">提供商</span><span className="text-[#5C4D43]">{m.provider}</span></div>
          )}
          {m.ollamaModelName && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">Ollama名称</span><span className="text-[#5C4D43] font-mono text-xs">{m.ollamaModelName}</span></div>
          )}
          {m.modelFilePath && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">模型路径</span><span className="text-[#5C4D43] font-mono text-xs break-all">{m.modelFilePath}</span></div>
          )}
          {m.embeddingFilePath && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">嵌入文件</span><span className="text-[#5C4D43] font-mono text-xs break-all">{m.embeddingFilePath}</span></div>
          )}
          {m.description && (
            <div className="flex items-start gap-3"><span className="text-[#8C7A6B] font-medium w-20 shrink-0">描述</span><span className="text-[#5C4D43]">{m.description}</span></div>
          )}
          {m.performanceMetrics && (
            <div>
              <span className="text-[#8C7A6B] font-medium w-20 float-left mr-2">性能指标</span>
              <div className="ml-20 grid grid-cols-5 gap-2">
                {Object.entries(m.performanceMetrics).map(([k, v]) => (
                  <div key={k} className="bg-[#F9F5F2] rounded-lg p-2 text-center">
                    <p className="text-[10px] text-[#8C7A6B]">{k}</p>
                    <p className="text-sm font-bold text-[#4A3B32]">{typeof v === 'number' ? v.toFixed(3) : v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">状态</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              m.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              {m.status === 'active'
                ? <><CheckCircle2 className="w-3.5 h-3.5" />可用</>
                : <><AlertCircle className="w-3.5 h-3.5" />不可用</>}
            </span>
          </div>
          {m.createdAt && (
            <div className="flex items-center gap-3"><span className="text-[#8C7A6B] font-medium w-20">创建时间</span><span className="text-[#5C4D43]">{formatDateTime(m.createdAt)}</span></div>
          )}
        </div>
        <div className="flex justify-end p-5 border-t border-[#EADDD5]">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] text-sm font-medium transition-colors border border-[#EADDD5]">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面组件 ====================
export default function ModelCenterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isTemplatePage = location.pathname.includes('/template');
  const [activeTab, setActiveTab] = useState<'model' | 'template'>(isTemplatePage ? 'template' : 'model');

  const handleTabChange = (tab: 'model' | 'template') => {
    setActiveTab(tab);
    navigate(tab === 'template' ? '/model/template' : '/model');
  };

  // Modal 状态
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showTemplateDetailModal, setShowTemplateDetailModal] = useState(false);
  const [showModelDetailModal, setShowModelDetailModal] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [configApiKeyModel, setConfigApiKeyModel] = useState<UnifiedModel | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<PromptTemplate | null>(null);
  const [editingModel, setEditingModel] = useState<UnifiedModel | null>(null);
  const [viewingModel, setViewingModel] = useState<UnifiedModel | null>(null);
  const [deleteId, setDeleteId] = useState<{ type: 'model' | 'template'; id: number } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 数据状态
  const [apiModels, setApiModels] = useState<UnifiedModel[]>([]);
  const [localModels, setLocalModels] = useState<UnifiedModel[]>([]);
  const [detectionModels, setDetectionModels] = useState<UnifiedModel[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  const loadData = () => {
    setModelsLoading(true);
    fetchModels().then((models) => {
      if (models && models.length > 0) {
        setApiModels((models as UnifiedModel[]).filter((m) => m.modelCategory === 'api'));
        setLocalModels((models as UnifiedModel[]).filter((m) => m.modelCategory === 'local_llm'));
        setDetectionModels((models as UnifiedModel[]).filter((m) => m.modelCategory === 'detection'));
      }
    }).catch(console.error).finally(() => setModelsLoading(false));

    setTemplatesLoading(true);
    fetchPromptTemplates().then((templates) => {
      if (templates) setPromptTemplates(templates);
    }).catch(console.error).finally(() => setTemplatesLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  // 分页
  const [templatePage, setTemplatePage] = useState(1);
  const templatesPerPage = 10;
  const allTemplates = promptTemplates;
  const totalTemplatePages = Math.ceil(allTemplates.length / templatesPerPage) || 1;
  const paginatedTemplates = allTemplates.slice((templatePage - 1) * templatesPerPage, templatePage * templatesPerPage);

  // 详情/编辑
  const handleViewTemplate = (t: PromptTemplate) => { setViewingTemplate(t); setShowTemplateDetailModal(true); };
  const handleEditTemplate = (t: PromptTemplate) => { setEditingTemplate(t); setShowTemplateModal(true); };
  const handleViewModel = (m: UnifiedModel) => { setViewingModel(m); setShowModelDetailModal(true); };
  const handleEditModel = (m: UnifiedModel) => { setEditingModel(m); setShowAddModelModal(true); };

  // 删除处理
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      if (deleteId.type === 'model') { await deleteModel(deleteId.id); }
      else { await deletePromptTemplate(deleteId.id); }
      setDeleteId(null);
      loadData();
    } catch (err) {
      console.error(err);
    } finally { setDeleteLoading(false); }
  };

  // 判断 API 模型是否需要配置 API Key
  const needsApiKey = (m: UnifiedModel) =>
    m.modelCategory === 'api' && !m.hasApiKey && m.isBuiltin;

  const ModelRow = ({ model }: { model: UnifiedModel }) => {
    const m = model;
    const isBuiltin = !!m.isBuiltin;
    const apiNeedsKey = needsApiKey(m);

    return (
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#FAF6F3] transition-colors border-b border-[#EADDD5] last:border-0">
        {/* 模型图标 */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          m.modelType === 'emoji' || m.modelType === 'fealearner' ? 'bg-purple-100' :
          m.modelCategory === 'api' ? 'bg-blue-100' : 'bg-teal-100'
        }`}>
          {m.modelType === 'emoji' ? <span className="text-base">🎭</span>
            : m.modelType === 'fealearner' ? <Brain className="w-4 h-4 text-purple-500" />
            : <Bot className="w-4 h-4 text-blue-500" />}
        </div>

        {/* 模型信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-[#4A3B32] truncate">{m.modelName}</p>
            {isBuiltin && (
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 border border-teal-200 text-teal-600">
                <Shield className="w-2.5 h-2.5" />预置
              </span>
            )}
            {apiNeedsKey && (
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 border border-orange-200 text-orange-600">
                <KeyRound className="w-2.5 h-2.5" />待配置
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">
            {m.provider ? `${m.provider} · ` : ''}
            {m.ollamaModelName ? `Ollama: ${m.ollamaModelName}` :
             m.modelFilePath || m.modelPath || m.modelType}
          </p>
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 可用状态 */}
          <button
            type="button"
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1 bg-emerald-50 border-emerald-200 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            可用
          </button>

          {/* 编辑 */}
          <button type="button"
            onClick={() => requestAnimationFrame(() => handleEditModel(m))}
            className="px-3 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 text-blue-600 rounded-full text-xs font-medium border border-blue-200 transition-all flex items-center gap-1">
            <Edit className="w-3 h-3" />
            编辑
          </button>
          {/* 详情 */}
          <button type="button"
            onClick={() => requestAnimationFrame(() => handleViewModel(m))}
            className="px-3 py-1.5 bg-gradient-to-r from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-200 text-orange-600 rounded-full text-xs font-medium border border-orange-200 transition-all flex items-center gap-1">
            <Eye className="w-3 h-3" />
            详情
          </button>
          {/* 删除 */}
          {!isBuiltin && (
            <button type="button"
              onClick={() => requestAnimationFrame(() => setDeleteId({ type: 'model', id: m.id }))}
              className="px-3 py-1.5 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-500 rounded-full text-xs font-medium border border-red-200 transition-all flex items-center gap-1">
              <Trash2 className="w-3 h-3" />
              删除
            </button>
          )}
        </div>
      </div>
    );
  };

  const TemplateRow = ({ template }: { template: PromptTemplate }) => {
    return (
      <tr className="hover:bg-[#FAF6F3] transition-colors border-b border-[#EADDD5] last:border-0">
        <td className="px-4 py-3.5"><span className="font-medium text-sm text-[#4A3B32]">{template.name}</span></td>
        <td className="px-4 py-3.5"><span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-lg">{template.taskType}</span></td>
        <td className="px-4 py-3.5 text-sm text-gray-500 max-w-xs truncate">{template.description || '—'}</td>
        <td className="px-4 py-3.5 text-xs text-gray-400">{formatDate(template.createdAt)}</td>
        <td className="px-4 py-3.5">
          <div className="flex items-center justify-center gap-1.5">
            <button onClick={() => handleEditTemplate(template)}
              className="px-2.5 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 text-blue-600 rounded-lg text-xs font-medium border border-blue-200 transition-all">
              <Edit className="w-3.5 h-3.5 inline" />
            </button>
            <button onClick={() => handleViewTemplate(template)}
              className="px-2.5 py-1.5 bg-gradient-to-r from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-200 text-orange-600 rounded-lg text-xs font-medium border border-orange-200 transition-all">
              <Eye className="w-3.5 h-3.5 inline" />
            </button>
            <button onClick={() => setDeleteId({ type: 'template', id: template.id })}
              className="px-2.5 py-1.5 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-500 rounded-lg text-xs font-medium border border-red-200 transition-all">
              <Trash2 className="w-3.5 h-3.5 inline" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-5 animate-fade-in">
      {/* 选项卡 */}
      <div className="shrink-0 bg-white rounded-2xl shadow-sm border border-[#F2E8E0] p-1.5 inline-flex self-start">
        <button onClick={() => handleTabChange('model')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
            activeTab === 'model' ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'
          }`}>
          <Settings className="w-4 h-4" />模型管理
        </button>
        <button onClick={() => handleTabChange('template')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
            activeTab === 'template' ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'
          }`}>
          <FileCode className="w-4 h-4" />指令模板管理
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'model' ? (
          <div className="space-y-4">
            {/* 添加工具栏 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] p-4 flex items-center justify-between">
              <button onClick={() => { setEditingModel(null); setShowAddModelModal(true); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm">
                <Plus className="w-4 h-4" />添加模型
              </button>
              <span className="text-sm text-[#8C7A6B]">
                {modelsLoading ? '加载中...' : `${apiModels.length + localModels.length + detectionModels.length} 个模型`}
              </span>
            </div>

            {/* API 模型 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-orange-50 to-orange-100/50 border-b border-orange-100">
                <Cloud className="w-4 h-4 text-orange-600" />
                <span className="font-semibold text-sm text-[#4A3B32]">API 模型</span>
                <span className="ml-auto px-2 py-0.5 bg-orange-200 text-orange-700 text-xs font-medium rounded-full">
                  {modelsLoading ? '...' : apiModels.length}
                </span>
              </div>
              {modelsLoading ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">加载中...</div>
              ) : apiModels.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">暂无 API 模型，点击上方按钮添加</div>
              ) : (
                apiModels.map((m) => <ModelRow key={m.id} model={m} />)
              )}
            </div>

            {/* 本地 LLM 模型 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-teal-50 to-teal-100/50 border-b border-teal-100">
                <Server className="w-4 h-4 text-teal-600" />
                <span className="font-semibold text-sm text-[#4A3B32]">本地 LLM 模型</span>
                <span className="ml-auto px-2 py-0.5 bg-teal-200 text-teal-700 text-xs font-medium rounded-full">
                  {modelsLoading ? '...' : localModels.length}
                </span>
              </div>
              {modelsLoading ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">加载中...</div>
              ) : localModels.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">暂无本地模型，点击上方按钮添加</div>
              ) : (
                localModels.map((m) => <ModelRow key={m.id} model={m} />)
              )}
            </div>

            {/* 检测模型 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-purple-50 to-purple-100/50 border-b border-purple-100">
                <Brain className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-sm text-[#4A3B32]">检测模型</span>
                <span className="ml-auto px-2 py-0.5 bg-purple-200 text-purple-700 text-xs font-medium rounded-full">
                  {modelsLoading ? '...' : detectionModels.length}
                </span>
              </div>
              {modelsLoading ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">加载中...</div>
              ) : detectionModels.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#8C7A6B]">暂无可用的检测模型，点击上方按钮添加</div>
              ) : (
                detectionModels.map((m) => <ModelRow key={m.id} model={m} />)
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 模板工具栏 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] p-4 flex items-center justify-between">
              <button onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm">
                <Plus className="w-4 h-4" />创建模板
              </button>
              <span className="text-sm text-[#8C7A6B]">
                {templatesLoading ? '加载中...' : `共 ${allTemplates.length} 个模板`}
              </span>
            </div>

            {/* 模板表格 */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#F2E8E0] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gradient-to-r from-[#F9F5F2] to-[#FDF9F6]">
                    <th className="text-left px-4 py-3.5 text-xs font-semibold text-[#5C4D43]">模板名称</th>
                    <th className="text-left px-4 py-3.5 text-xs font-semibold text-[#5C4D43]">任务类型</th>
                    <th className="text-left px-4 py-3.5 text-xs font-semibold text-[#5C4D43]">说明</th>
                    <th className="text-left px-4 py-3.5 text-xs font-semibold text-[#5C4D43]">创建时间</th>
                    <th className="text-center px-4 py-3.5 text-xs font-semibold text-[#5C4D43]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {templatesLoading ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-[#8C7A6B]">加载中...</td></tr>
                  ) : paginatedTemplates.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-sm text-[#8C7A6B]">暂无模板，点击上方按钮创建</td></tr>
                  ) : (
                    paginatedTemplates.map((t) => <TemplateRow key={t.id} template={t} />)
                  )}
                </tbody>
              </table>

              {/* 分页 */}
              {totalTemplatePages > 1 && (
                <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#F9F5F2] to-white border-t border-[#EADDD5]">
                  <span className="text-xs text-[#8C7A6B]">
                    显示 {(templatePage - 1) * templatesPerPage + 1}–{Math.min(templatePage * templatesPerPage, allTemplates.length)}，共 {allTemplates.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setTemplatePage(1)} disabled={templatePage === 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      首页
                    </button>
                    <button onClick={() => setTemplatePage(templatePage - 1)} disabled={templatePage === 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    {Array.from({ length: Math.min(totalTemplatePages, 7) }, (_, i) => {
                      const page = i + 1;
                      return (
                        <button key={page} onClick={() => setTemplatePage(page)}
                          className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                            templatePage === page ? 'bg-orange-500 text-white' : 'hover:bg-gray-50 text-gray-600'
                          }`}>
                          {page}
                        </button>
                      );
                    })}
                    <button onClick={() => setTemplatePage(templatePage + 1)} disabled={templatePage >= totalTemplatePages}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setTemplatePage(totalTemplatePages)} disabled={templatePage >= totalTemplatePages}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      末页
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <AddModelModal
        isOpen={showAddModelModal}
        onClose={() => { setShowAddModelModal(false); setEditingModel(null); }}
        editData={editingModel}
        onSuccess={loadData}
      />
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => { setShowTemplateModal(false); setEditingTemplate(null); }}
        editData={editingTemplate}
        onSuccess={() => { loadData(); setTemplatePage(1); }}
      />
      <TemplateDetailModal
        isOpen={showTemplateDetailModal}
        onClose={() => { setShowTemplateDetailModal(false); setViewingTemplate(null); }}
        template={viewingTemplate}
      />
      <ModelDetailModal
        isOpen={showModelDetailModal}
        onClose={() => { setShowModelDetailModal(false); setViewingModel(null); }}
        model={viewingModel}
      />
      <ApiKeyConfigModal
        isOpen={showApiKeyModal}
        onClose={() => { setShowApiKeyModal(false); setConfigApiKeyModel(null); }}
        model={configApiKeyModel}
        onSuccess={() => { setShowApiKeyModal(false); setConfigApiKeyModel(null); loadData(); }}
      />
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={`确认删除${deleteId?.type === 'model' ? '模型' : '模板'}？`}
        message={deleteId?.type === 'model'
          ? '内置模型禁止删除。用户模型删除后将无法恢复。'
          : '删除后该模板将无法恢复。'}
        confirmText="确认删除"
        loading={deleteLoading}
      />
    </div>
  );
}
