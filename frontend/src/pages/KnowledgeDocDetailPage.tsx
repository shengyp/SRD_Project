import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Trash2,
  FileText,
  File,
  FileCode,
  Loader,
} from 'lucide-react';
import { formatDocTime } from '../utils/dateFormat';
import {
  fetchKnowledgeDocument,
  fetchDocumentPreview,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  type KnowledgeDocument,
} from '../api';
import { useAuthStore } from '../store/authStore';

// 文件大小格式化
function getSizeDisplay(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// 获取格式图标
function getFormatIcon(format: string) {
  switch (format) {
    case 'pdf': return <FileText className="w-6 h-6 text-red-500" />;
    case 'docx': return <File className="w-6 h-6 text-blue-500" />;
    case 'md': return <FileCode className="w-6 h-6 text-green-500" />;
    default: return <File className="w-6 h-6 text-gray-500" />;
  }
}

// PDF 预览组件：使用 Blob URL 方式预览（兼容现代浏览器）
function PDFPreview({ documentId, fileName }: { documentId: number | string; fileName: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        // 优先使用流式端点获取 PDF 数据（推荐）
        const url = `/api/knowledge/documents/${documentId}/preview-stream`;

        console.log('[PDFPreview] 加载 PDF from:', url);

        const response = await fetch(url);

        if (!response.ok) {
          // 如果流式端点失败，尝试 base64 端点作为备用
          console.log('[PDFPreview] 流式端点失败，尝试 base64 端点');
          const base64Url = `/api/knowledge/documents/${documentId}/base64`;
          const base64Response = await fetch(base64Url);

          if (!base64Response.ok) {
            throw new Error(`加载失败: ${base64Response.status} ${base64Response.statusText}`);
          }

          const result = await base64Response.json();

          if (result.success && result.data && result.data.dataUrl) {
            // base64 方式 - 使用 data URL
            setPdfUrl(result.data.dataUrl);
          } else {
            throw new Error('无法获取 PDF 数据');
          }
          return;
        }

        const blob = await response.blob();
        console.log('[PDFPreview] Blob size:', blob.size, 'type:', blob.type);

        if (blob.size === 0) {
          throw new Error('PDF 文件为空');
        }

        // 创建 Blob URL 并设置 PDF MIME 类型
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (err) {
        console.error('PDF 加载失败:', err);
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [documentId]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Loader className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="text-gray-600 font-medium">正在加载 PDF...</p>
        <p className="text-gray-400 text-sm mt-2">请耐心等待...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <FileText className="w-16 h-16 text-red-400 mb-4" />
        <p className="text-gray-600 font-medium mb-2">PDF 加载失败</p>
        <p className="text-gray-400 text-sm mb-4">{error}</p>
        <button
          onClick={() => downloadKnowledgeDocument(Number(documentId), fileName)}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4 inline mr-2" />
          下载查看
        </button>
      </div>
    );
  }

  if (pdfUrl) {
    return (
      <iframe
        src={pdfUrl}
        className="w-full h-full min-h-[600px]"
        title={`${fileName} 预览`}
      />
    );
  }

  return null;
}

export default function KnowledgeDocDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const docId = searchParams.get('id');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'info'>('preview');

  useEffect(() => {
    if (!docId) {
      navigate('/knowledge');
      return;
    }

    const loadDoc = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // 支持整数 ID 或字符串 ID（标题/文件名，由后端解析）
        const docData = await fetchKnowledgeDocument(docId as string);
        setDoc(docData);
      } catch (err) {
        console.error('加载文档详情失败:', err);
        setLoadError('加载文档详情失败，请检查网络连接');
      } finally {
        setLoading(false);
      }
    };

    loadDoc();
  }, [docId, navigate]);

  useEffect(() => {
    if (!doc) return;
    if (activeTab === 'preview') {
      fetchDocumentPreview(doc.id as string)
        .then((preview) => {
          const content = typeof preview === 'string' ? preview : ((preview as any)?.content || (preview as any)?.preview || '');
          setPreviewContent(content);
        })
        .catch(() => setPreviewContent(''));
    }
  }, [doc, activeTab]);

  // Markdown 渲染辅助（简单的标题/列表/粗体替换）
  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return <h1 key={i} className="text-2xl font-bold text-[#162033] mt-6 mb-3">{trimmed.slice(2)}</h1>;
      }
      if (trimmed.startsWith('## ')) {
        return <h2 key={i} className="text-xl font-bold text-[#162033] mt-5 mb-2">{trimmed.slice(3)}</h2>;
      }
      if (trimmed.startsWith('### ')) {
        return <h3 key={i} className="text-lg font-semibold text-[#1E3A5F] mt-4 mb-2">{trimmed.slice(4)}</h3>;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return <li key={i} className="ml-4 list-disc text-[#415168] leading-relaxed">{renderInline(trimmed.slice(2))}</li>;
      }
      if (/^\d+\.\s/.test(trimmed)) {
        return <li key={i} className="ml-4 list-decimal text-[#415168] leading-relaxed">{renderInline(trimmed.replace(/^\d+\.\s/, ''))}</li>;
      }
      if (trimmed === '') {
        return <br key={i} />;
      }
      return <p key={i} className="text-[#415168] leading-relaxed mb-1">{renderInline(line)}</p>;
    });
  };

  const renderInline = (text: string) => {
    // 处理 **bold** 和 *italic*
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  const handleBack = () => {
    navigate('/knowledge');
  };

  const handleDelete = async () => {
    if (!doc) return;
    if (!confirm(`确定要删除文档「${doc.title}」吗？此操作不可恢复。`)) return;
    try {
      await deleteKnowledgeDocument(doc.id);
      navigate('/knowledge');
    } catch (err) {
      alert('删除失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-[#2F6BFF] mx-auto mb-4 animate-spin" />
          <p className="text-[#64748B]">加载中...</p>
        </div>
      </div>
    );
  }

  if (loadError || !doc) {
    return (
      <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-6 animate-fade-in">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-500 mb-2">文档不存在</h2>
            <p className="text-gray-400 mb-4">{loadError || '您访问的文档不存在或已被删除'}</p>
            <button
              onClick={() => navigate('/knowledge')}
              className="px-6 py-3 bg-[#2F6BFF] hover:bg-[#2458D6] text-white rounded-xl transition-colors font-medium"
            >
              返回知识库
            </button>
          </div>
        </div>
      </div>
    );
  }

  const topicName = doc.topic?.topicName || '';
  const subTopicName = doc.subTopic?.subTopicName || '';
  const sizeDisplay = doc.sizeDisplay || getSizeDisplay(doc.fileSize || 0);
  const keywords = doc.keywords || [];
  const format = (doc.format || 'txt') as string;
  const uploadTime = formatDocTime(doc.uploadedAt, doc.createdAt);

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full gap-4 md:gap-6 animate-fade-in">
      <div className="shrink-0 flex items-center justify-end">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 px-4 py-2 bg-[#F1F5FA] hover:bg-[#E2E8F0] text-[#415168] rounded-xl transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-[28px] shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0] overflow-hidden">
        <div className="h-full flex flex-col lg:flex-row">
          <div className="w-full lg:w-2/5 p-6 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] overflow-y-auto">
            <div className="space-y-6">
              <div className="bg-[#F7FAFD] rounded-2xl p-5 border border-[#E2E8F0]">
                <h3 className="text-lg font-semibold text-[#162033] mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#2F6BFF]" />
                  文档信息
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">文档标题</label>
                    <p className="text-[#162033] font-medium mt-1">{doc.title}</p>
                  </div>
                  {topicName && (
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">主题</label>
                      <p className="text-[#162033] font-medium mt-1">{topicName}</p>
                    </div>
                  )}
                  {subTopicName && (
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">子主题</label>
                      <p className="text-[#162033] font-medium mt-1">{subTopicName}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 关键词 */}
              {keywords.length > 0 && (
                <div className="bg-[#F7FAFD] rounded-2xl p-5 border border-[#E2E8F0]">
                  <h3 className="text-lg font-semibold text-[#162033] mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#2F6BFF]" />
                    关键词
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((kw, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 bg-white text-blue-700 text-sm rounded-full border border-blue-200 font-medium"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 文档描述 */}
              {doc.description && (
                <div className="bg-[#F7FAFD] rounded-2xl p-5 border border-[#E2E8F0]">
                  <h3 className="text-lg font-semibold text-[#162033] mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#2F6BFF]" />
                    文档描述
                  </h3>
                  <p className="text-[#415168] leading-relaxed">{doc.description}</p>
                </div>
              )}

              <div className="bg-[#F7FAFD] rounded-2xl p-5 border border-[#E2E8F0]">
                <h3 className="text-lg font-semibold text-[#162033] mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#2F6BFF]" />
                  文件信息
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">文件名</label>
                    <p className="text-[#162033] font-medium mt-1 text-sm break-all">{doc.fileName || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">文件大小</label>
                    <p className="text-[#162033] font-medium mt-1">{sizeDisplay}</p>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">文件格式</label>
                    <p className="text-[#162033] font-medium mt-1 uppercase">{format}</p>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-semibold uppercase tracking-wide">上传时间</label>
                    <p className="text-[#162033] font-medium mt-1 text-sm">{uploadTime}</p>
                  </div>
                </div>
              </div>

              {/* RAG存储路径 */}
              {doc.ragPath && (
                <div className="bg-[#F7FAFD] rounded-2xl p-5 border border-[#E2E8F0]">
                  <h3 className="text-lg font-semibold text-[#162033] mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#2F6BFF]" />
                    RAG存储路径
                  </h3>
                  <p className="text-[#415168] text-sm font-mono bg-white px-3 py-2 rounded-lg border border-[#DCE7F5] break-all">
                    {doc.ragPath}
                  </p>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => downloadKnowledgeDocument(doc.id, doc.fileName)}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-semibold"
                >
                  <Download className="w-5 h-5" />
                  下载文档
                </button>
                {isAdmin && (
                  <button
                    onClick={handleDelete}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors font-medium"
                  >
                    <Trash2 className="w-5 h-5" />
                    删除
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：文档预览面板 */}
          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* 标签页切换 */}
            <div className="flex border-b border-[#E2E8F0]">
              <button
                className={`px-6 py-4 font-semibold transition-colors flex items-center gap-2 ${
                  activeTab === 'preview'
                    ? 'text-blue-600 border-b-2 border-blue-500'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('preview')}
              >
                <FileText className="w-4 h-4" />
                文档预览
              </button>
              <button
                className={`px-6 py-4 font-semibold transition-colors flex items-center gap-2 ${
                  activeTab === 'info'
                    ? 'text-blue-600 border-b-2 border-blue-500'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('info')}
              >
                <File className="w-4 h-4" />
                元数据
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 p-6 overflow-y-auto">
              {activeTab === 'preview' ? (
                format === 'pdf' ? (
                  <div className="w-full h-full min-h-[600px] flex flex-col">
                    <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                      <PDFPreview documentId={doc.id} fileName={doc.fileName} />
                    </div>
                  </div>
                ) : previewContent ? (
                  <div className="prose max-w-none text-[#162033]">
                    {format === 'md' ? (
                      <div className="space-y-1">{renderMarkdown(previewContent)}</div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed">{previewContent}</pre>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center min-h-[400px]">
                    <div className="bg-gray-50 rounded-xl p-12 text-center">
                      {getFormatIcon(format)}
                      <p className="text-gray-500 mt-4">暂无可预览内容</p>
                      <p className="text-sm text-gray-400 mt-2">该文档可能为 DOCX 格式，需要下载后查看</p>
                      <button
                        onClick={() => downloadKnowledgeDocument(doc.id, doc.fileName)}
                        className="mt-4 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors text-sm font-medium"
                      >
                        <Download className="w-4 h-4 inline mr-2" />
                        下载查看
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="bg-gray-50 rounded-xl p-6">
                  <pre className="text-sm text-[#415168] whitespace-pre-wrap">
{JSON.stringify({
  id: doc.id,
  title: doc.title,
  topic: topicName,
  subTopic: subTopicName,
  keywords: keywords,
  format: format,
  size: sizeDisplay,
  status: doc.uploadStatus,
  uploadTime: uploadTime,
  description: doc.description,
  fileName: doc.fileName,
  fileType: doc.fileType,
  ragPath: doc.ragPath,
  isIndexed: doc.isIndexed,
  usageCount: doc.usageCount,
}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
