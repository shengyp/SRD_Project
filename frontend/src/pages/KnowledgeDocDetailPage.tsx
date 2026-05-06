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
import ActionCapsuleButton from '../components/ActionCapsuleButton';
import DocumentPreview from '../components/knowledge/DocumentPreview';

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
      if (['pdf', 'docx', 'doc'].includes((doc.format || '').toLowerCase())) {
        setPreviewContent('');
        return;
      }
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
  const docStatusLabel =
    doc.uploadStatus === 'uploaded'
      ? '已入库'
      : doc.uploadStatus === 'uploading'
        ? '处理中'
        : doc.uploadStatus === 'failed'
          ? '失败'
          : '待确认';
  const metaLine = [topicName, subTopicName].filter(Boolean).join(' / ');

  const infoCards = [
    {
      title: '文档信息',
      content: (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">文档标题</label>
            <p className="mt-1.5 text-[15px] font-semibold leading-7 text-[#162033]">{doc.title}</p>
          </div>
          {topicName && (
            <div>
              <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">主题</label>
              <p className="mt-1.5 text-sm text-[#162033]">{topicName}</p>
            </div>
          )}
          {subTopicName && (
            <div>
              <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">子主题</label>
              <p className="mt-1.5 text-sm text-[#162033]">{subTopicName}</p>
            </div>
          )}
        </div>
      ),
    },
    keywords.length > 0
      ? {
          title: '关键词',
          content: (
            <div className="flex flex-wrap gap-2.5">
              {keywords.map((kw, i) => (
                <span
                  key={i}
                  className="rounded-full border border-[#CFE0FF] bg-white px-3 py-1.5 text-sm font-medium text-[#2F6BFF]"
                >
                  {kw}
                </span>
              ))}
            </div>
          ),
        }
      : null,
    doc.description
      ? {
          title: '文档描述',
          content: <p className="text-sm leading-7 text-[#415168]">{doc.description}</p>,
        }
      : null,
    {
      title: '文件信息',
      content: (
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <div>
            <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">文件名</label>
            <p className="mt-1.5 break-all text-sm font-medium leading-6 text-[#162033]">{doc.fileName || '-'}</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">文件大小</label>
            <p className="mt-1.5 text-sm font-medium text-[#162033]">{sizeDisplay}</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">文件格式</label>
            <p className="mt-1.5 text-sm font-medium uppercase text-[#162033]">{format}</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold tracking-wide text-[#64748B]">上传时间</label>
            <p className="mt-1.5 text-sm font-medium text-[#162033]">{uploadTime}</p>
          </div>
        </div>
      ),
    },
  ].filter(Boolean) as { title: string; content: React.ReactNode }[];

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full animate-fade-in">
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E8EEF6] bg-[#FCFDFF] px-5 py-4 lg:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2F6BFF] shadow-[0_8px_18px_rgba(47,107,255,0.12)]">
                {getFormatIcon(format)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded-full bg-[#EEF4FF] px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]">
                    {format.toUpperCase()}
                  </span>
                  <span className="rounded-full bg-[#F5F7FB] px-2.5 py-1 text-xs font-medium text-[#64748B]">
                    {docStatusLabel}
                  </span>
                  {topicName && (
                    <span className="rounded-full bg-[#F5F8FF] px-2.5 py-1 text-xs font-medium text-[#4B5EAA]">
                      {topicName}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3">
                  <h1 className="min-w-0 text-[24px] font-bold leading-tight text-[#162033]">{doc.title}</h1>
                  {subTopicName && (
                    <span className="w-fit rounded-full bg-[#F5F7FB] px-2.5 py-1 text-xs font-medium text-[#64748B]">
                      {subTopicName}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-[#6B7B8F]">
                  {metaLine || '未分类'}{uploadTime ? ` · 上传于 ${uploadTime}` : ''}
                </p>
              </div>
            </div>

            <ActionCapsuleButton
              onClick={handleBack}
              variant="neutral"
              className="shrink-0"
              icon={<ArrowLeft className="h-4 w-4" />}
            >
              返回列表
            </ActionCapsuleButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="w-full overflow-y-auto border-b border-[#E2E8F0] bg-[#FBFCFE] p-4 lg:w-[360px] lg:border-b-0 lg:border-r lg:p-5 xl:w-[380px]">
            <div className="space-y-4">
              {infoCards.map((card) => (
                <section key={card.title} className="rounded-[22px] border border-[#E7EDF7] bg-[#F7FAFD] p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#162033]">
                    <FileText className="h-4.5 w-4.5 text-[#2F6BFF]" />
                    {card.title}
                  </h3>
                  {card.content}
                </section>
              ))}

              {doc.ragPath && (
                <section className="rounded-[22px] border border-[#E7EDF7] bg-[#F7FAFD] p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#162033]">
                    <FileText className="h-4.5 w-4.5 text-[#2F6BFF]" />
                    RAG存储路径
                  </h3>
                  <p className="break-all rounded-2xl border border-[#DCE7F5] bg-white px-3 py-3 text-sm leading-6 text-[#415168]">
                    {doc.ragPath}
                  </p>
                </section>
              )}

              <div className="space-y-3 pt-1">
                <ActionCapsuleButton
                  onClick={() => downloadKnowledgeDocument(doc.id, doc.fileName)}
                  variant="solid"
                  size="lg"
                  className="w-full"
                  icon={<Download className="h-5 w-5" />}
                >
                  下载文档
                </ActionCapsuleButton>
                {isAdmin && (
                  <ActionCapsuleButton
                    onClick={handleDelete}
                    tone="red"
                    variant="soft"
                    size="lg"
                    className="w-full"
                    icon={<Trash2 className="h-5 w-5" />}
                  >
                    删除文档
                  </ActionCapsuleButton>
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <div className="flex border-b border-[#E2E8F0] bg-white px-4 lg:px-5">
              <button
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-4 text-sm font-semibold transition-colors ${
                  activeTab === 'preview'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('preview')}
              >
                <FileText className="w-4 h-4" />
                文档预览
              </button>
              <button
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-4 text-sm font-semibold transition-colors ${
                  activeTab === 'info'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('info')}
              >
                <File className="w-4 h-4" />
                元数据
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white p-4 lg:p-5">
              {activeTab === 'preview' ? (
                ['pdf', 'docx', 'doc'].includes(format) ? (
                  <div className="flex h-full min-h-0 w-full flex-col">
                    <div className="flex-1 overflow-hidden rounded-[22px] border border-[#DCE5F2] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                      <DocumentPreview documentId={doc.id} fileName={doc.fileName} format={format} />
                    </div>
                  </div>
                ) : previewContent ? (
                  <div className="prose max-w-none rounded-[22px] border border-[#E2E8F0] bg-white p-6 text-[#162033] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    {format === 'md' ? (
                      <div className="space-y-1">{renderMarkdown(previewContent)}</div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed">{previewContent}</pre>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center min-h-[400px]">
                    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-12 text-center">
                      {getFormatIcon(format)}
                      <p className="text-gray-500 mt-4">暂无可预览内容</p>
                      <ActionCapsuleButton
                        onClick={() => downloadKnowledgeDocument(doc.id, doc.fileName)}
                        className="mt-4"
                        icon={<Download className="w-4 h-4" />}
                        variant="solid"
                      >
                        下载查看
                      </ActionCapsuleButton>
                    </div>
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
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
          </section>
        </div>
      </div>
    </div>
  );
}
