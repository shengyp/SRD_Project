import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Download, Loader2, AlertCircle } from 'lucide-react';
import { fetchDocumentPreview, fetchKnowledgeDocument, downloadKnowledgeDocument, type KnowledgeDocument } from '../api';
import DocumentPreview from '../components/knowledge/DocumentPreview';
import { findHighlightRange } from '../utils/highlightMatch';

export default function DocPreviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get('id');
  const snippet = searchParams.get('snippet');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const highlightRef = useRef<HTMLSpanElement | null>(null);

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
        const docData = await fetchKnowledgeDocument(docId);
        const previewData = await fetchDocumentPreview(docId);
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
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/chat');
  };

  const highlightRange = useMemo(() => {
    if (!doc?.content) return null;
    return findHighlightRange(doc.content, snippet);
  }, [doc?.content, snippet]);

  useEffect(() => {
    if (!highlightRange || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [highlightRange]);

  const highlightedContent = useMemo(() => {
    if (!doc?.content || !highlightRange) return null;
    return {
      before: doc.content.slice(0, highlightRange.start),
      match: doc.content.slice(highlightRange.start, highlightRange.end),
      after: doc.content.slice(highlightRange.end),
    };
  }, [doc?.content, highlightRange]);

  const highlightedExcerpt = useMemo(() => {
    if (!doc?.content || !highlightRange) return null;
    const excerptPadding = 120;
    const start = Math.max(0, highlightRange.start - excerptPadding);
    const end = Math.min(doc.content.length, highlightRange.end + excerptPadding);
    return {
      before: `${start > 0 ? '... ' : ''}${doc.content.slice(start, highlightRange.start)}`,
      match: doc.content.slice(highlightRange.start, highlightRange.end),
      after: `${doc.content.slice(highlightRange.end, end)}${end < doc.content.length ? ' ...' : ''}`,
    };
  }, [doc?.content, highlightRange]);

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center space-y-3 text-[#64748B]">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm">正在加载文档...</span>
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center space-y-3 text-[#94A3B8]">
          <AlertCircle className="w-12 h-12 opacity-40" />
          <p className="text-sm">{error || '文档不存在'}</p>
          <button
            onClick={handleGoBack}
            className="mt-2 px-4 py-2 bg-[#F1F5FA] hover:bg-[#E2E8F0] rounded-full text-sm text-[#415168] transition-colors"
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
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-[#F7FAFD]">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleGoBack}
            className="flex items-center space-x-2 px-4 py-2 bg-[#F1F5FA] hover:bg-[#E2E8F0] rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#415168]" />
            <span className="text-sm font-medium text-[#415168]">返回智能问答</span>
          </button>
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-[#2F6BFF]" />
            <span className="font-bold text-[#162033] text-lg">{doc.title}</span>
          </div>
        </div>
        <button
          onClick={() => doc && downloadKnowledgeDocument(doc.id, doc.fileName)}
          className="px-4 py-2 bg-[#F1F5FA] text-[#415168] rounded-md text-sm font-medium hover:bg-[#E2E8F0] transition-colors flex items-center space-x-2"
        >
          <Download className="w-4 h-4" />
          <span>下载</span>
        </button>
      </div>

      {/* 文档内容区 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full min-h-full px-6 py-8 bg-white">
          <div className="space-y-6 text-[#415168] leading-relaxed w-full">
            <h1 className="text-3xl font-bold text-center mb-8 text-[#162033]">
              {doc.title.replace(/\.[^/.]+$/, '')}
            </h1>

            {/* 文档信息卡片 */}
            {(doc.topic || doc.subTopic) && (
              <div className="bg-[#F7FAFD] p-4 rounded-lg border border-[#E2E8F0]">
                <h4 className="text-sm font-bold text-[#64748B] mb-2">文档信息</h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-[#415168]">
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
            {['pdf', 'docx', 'doc'].includes(doc.format?.toLowerCase() || '') ? (
              <div className="space-y-4">
                {highlightedContent ? (
                  <div className="rounded-[18px] border border-[#E8D98E] bg-[#FFFBE6] px-4 py-3 text-[14px] leading-7 text-[#5E4B14]">
                    <div className="mb-1 text-[13px] font-semibold text-[#8A6B11]">定位片段</div>
                    <div className="whitespace-pre-wrap break-words">
                      {highlightedExcerpt?.before}
                      <span className="rounded-[8px] bg-[#FFF2A8] px-1 py-0.5 text-[#223248] shadow-[0_0_0_1px_rgba(233,188,50,0.25)]">
                        {highlightedExcerpt?.match}
                      </span>
                      {highlightedExcerpt?.after}
                    </div>
                  </div>
                ) : snippet ? (
                  <div className="rounded-[18px] border border-[#E7EDF5] bg-[#F8FBFE] px-4 py-3 text-[13px] leading-6 text-[#617386]">
                    当前文档已打开，但这条证据片段未能在抽取文本中精确定位，下面继续展示原文预览。
                  </div>
                ) : null}
                <DocumentPreview
                  documentId={doc.id}
                  fileName={doc.fileName}
                  format={doc.format}
                  highlightSnippet={snippet}
                />
              </div>
            ) : doc.content ? (
              <div className="rounded-[20px] border border-[#E7EDF5] bg-[#FCFDFE] px-5 py-5 text-[15px] leading-8 text-[#415168] whitespace-pre-wrap break-words">
                {highlightedContent ? (
                  <>
                    {highlightedContent.before}
                    <span
                      ref={highlightRef}
                      className="rounded-[8px] bg-[#FFF2A8] px-1 py-0.5 text-[#223248] shadow-[0_0_0_1px_rgba(233,188,50,0.25)]"
                    >
                      {highlightedContent.match}
                    </span>
                    {highlightedContent.after}
                  </>
                ) : (
                  doc.content
                )}
              </div>
            ) : (
              <div className="bg-[#F7FAFD] p-6 rounded-lg border border-[#E2E8F0] text-center text-sm text-[#94A3B8]">
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
