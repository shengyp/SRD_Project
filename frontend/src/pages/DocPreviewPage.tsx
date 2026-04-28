import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Download, Loader2, AlertCircle } from 'lucide-react';
import { fetchDocumentPreview, fetchKnowledgeDocument, downloadKnowledgeDocument, type KnowledgeDocument } from '../api';

export default function DocPreviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);

  useEffect(() => {
    if (!docId) {
      setError('缺少文档 ID 参数');
      setLoading(false);
      return;
    }

    async function loadDoc() {
      setLoading(true);
      setError(null);

      if (!docId) {
        setError('缺少文档 ID 参数');
        setLoading(false);
        return;
      }

      try {
        // 后端 API 支持字符串 ID（文件名）和数字 ID，统一传 docId
        const [docData, previewData] = await Promise.all([
          fetchKnowledgeDocument(docId),
          fetchDocumentPreview(docId),
        ]);

        // 合并文档详情和预览内容
        setDoc({ ...docData, content: previewData.content } as KnowledgeDocument);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载文档失败';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    loadDoc();
  }, [docId]);

  const handleGoBack = () => {
    navigate('/chat');
  };

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center space-y-3 text-[#8C7A6B]">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm">正在加载文档...</span>
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center space-y-3 text-[#A89F95]">
          <AlertCircle className="w-12 h-12 opacity-40" />
          <p className="text-sm">{error || '文档不存在'}</p>
          <button
            onClick={handleGoBack}
            className="mt-2 px-4 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] rounded-full text-sm text-[#5C4D43] transition-colors"
          >
            返回智能问答
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full bg-white">
      {/* 头部栏 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#EADDD5] bg-[#FAF6F3]">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleGoBack}
            className="flex items-center space-x-2 px-4 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#5C4D43]" />
            <span className="text-sm font-medium text-[#5C4D43]">返回智能问答</span>
          </button>
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-[#8C7A6B]" />
            <span className="font-bold text-[#4A362C] text-lg">{doc.title}</span>
          </div>
        </div>
        <button
          onClick={() => doc && downloadKnowledgeDocument(doc.id, doc.fileName)}
          className="px-4 py-2 bg-[#F4EBE1] text-[#5C4D43] rounded-md text-sm font-medium hover:bg-[#EADDD5] transition-colors flex items-center space-x-2"
        >
          <Download className="w-4 h-4" />
          <span>下载</span>
        </button>
      </div>

      {/* 文档内容区 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full min-h-full px-6 py-8 bg-white">
          <div className="space-y-6 text-[#5C4D43] leading-relaxed w-full">
            <h1 className="text-3xl font-bold text-center mb-8 text-[#4A362C]">
              {doc.title.replace(/\.[^/.]+$/, '')}
            </h1>

            {/* 文档信息卡片 */}
            {(doc.topic || doc.subTopic) && (
              <div className="bg-[#FAF6F3] p-4 rounded-lg border border-[#EADDD5]">
                <h4 className="text-sm font-bold text-[#8C7A6B] mb-2">文档信息</h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-[#5C4D43]">
                  {doc.topic && (
                    <div>
                      <span className="font-medium">主题：</span>{typeof doc.topic === 'string' ? doc.topic : doc.topic?.topicName}
                    </div>
                  )}
                  {doc.subTopic && (
                    <div>
                      <span className="font-medium">子主题：</span>{typeof doc.subTopic === 'string' ? doc.subTopic : doc.subTopic?.subTopicName}
                    </div>
                  )}
                  <div>
                    <span className="font-medium">格式：</span>{doc.format?.toUpperCase()}
                  </div>
                </div>
              </div>
            )}

            {/* 文档正文 */}
            {doc.content ? (
              <div className="whitespace-pre-wrap">
                {doc.content.split('\n').map((line, i) => (
                  line.trim() ? (
                    <p key={i}>{line}</p>
                  ) : (
                    <br key={i} />
                  )
                ))}
              </div>
            ) : (
              <div className="bg-[#FAF6F3] p-6 rounded-lg border border-[#EADDD5] text-center text-sm text-[#A89F95]">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>该文档暂无正文内容</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
