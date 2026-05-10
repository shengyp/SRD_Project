import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2 } from 'lucide-react';
import { downloadKnowledgeDocument } from '../../api';
import { pickSearchSnippet } from '../../utils/highlightMatch';

interface DocumentPreviewProps {
  documentId: number | string;
  fileName?: string;
  format?: string;
  className?: string;
  highlightSnippet?: string | null;
}

function PreviewFallback({
  documentId,
  fileName,
  message,
}: {
  documentId: number | string;
  fileName?: string;
  message: string;
}) {
  return (
    <div className="flex h-[72vh] flex-col items-center justify-center rounded-[20px] border border-[#E7EDF5] bg-[#FCFDFE] px-6 text-center">
      <AlertCircle className="mb-3 h-10 w-10 text-[#94A3B8]" />
      <p className="text-sm text-[#64748B]">{message}</p>
      <button
        onClick={() => downloadKnowledgeDocument(documentId, fileName)}
        className="mt-4 rounded-full bg-[#F1F5FA] px-4 py-2 text-sm text-[#415168] transition-colors hover:bg-[#E2E8F0]"
      >
        下载后查看
      </button>
    </div>
  );
}

function PdfPreview({
  documentId,
  fileName,
  highlightSnippet,
}: {
  documentId: number | string;
  fileName?: string;
  highlightSnippet?: string | null;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/knowledge/documents/${documentId}/preview-stream`);
        if (!response.ok) {
          throw new Error(`PDF 预览加载失败: HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (!blob.size) {
          throw new Error('PDF 文件为空');
        }

        const searchSnippet = pickSearchSnippet(highlightSnippet);
        objectUrl = URL.createObjectURL(blob);
        if (searchSnippet) {
          objectUrl = `${objectUrl}#search=${encodeURIComponent(searchSnippet)}`;
        }
        setPdfUrl(objectUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'PDF 预览加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, highlightSnippet]);

  if (loading) {
    return (
      <div className="flex h-[72vh] items-center justify-center rounded-[20px] border border-[#E7EDF5] bg-[#FCFDFE]">
        <div className="flex flex-col items-center space-y-3 text-[#64748B]">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">正在加载 PDF 预览...</span>
        </div>
      </div>
    );
  }

  if (error || !pdfUrl) {
    return <PreviewFallback documentId={documentId} fileName={fileName} message={error || 'PDF 预览加载失败'} />;
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#E7EDF5] bg-white">
      <iframe src={pdfUrl} title={fileName || String(documentId)} className="h-[72vh] w-full" />
    </div>
  );
}

function highlightDocxSnippet(container: HTMLDivElement, rawSnippet?: string | null): boolean {
  const snippet = pickSearchSnippet(rawSnippet);
  if (!snippet) return false;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || '';
      return text.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  const texts: string[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    texts.push(current.textContent || '');
    current = walker.nextNode();
  }

  if (!textNodes.length) return false;

  const fullText = texts.join('');
  const searchIndex = fullText.toLowerCase().indexOf(snippet.toLowerCase());
  if (searchIndex < 0) return false;

  let consumed = 0;
  let startNodeIndex = -1;
  let endNodeIndex = -1;
  let startOffset = 0;
  let endOffset = 0;

  for (let i = 0; i < texts.length; i += 1) {
    const nextConsumed = consumed + texts[i].length;
    if (startNodeIndex === -1 && searchIndex < nextConsumed) {
      startNodeIndex = i;
      startOffset = Math.max(0, searchIndex - consumed);
    }
    if (startNodeIndex !== -1 && searchIndex + snippet.length <= nextConsumed) {
      endNodeIndex = i;
      endOffset = Math.max(0, searchIndex + snippet.length - consumed);
      break;
    }
    consumed = nextConsumed;
  }

  if (startNodeIndex === -1 || endNodeIndex === -1) return false;

  const range = document.createRange();
  range.setStart(textNodes[startNodeIndex], startOffset);
  range.setEnd(textNodes[endNodeIndex], endOffset);

  const mark = document.createElement('mark');
  mark.className = 'rounded-[6px] bg-[#FFF2A8] px-1 py-0.5 text-inherit shadow-[0_0_0_1px_rgba(233,188,50,0.25)]';
  try {
    range.surroundContents(mark);
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  } catch {
    return false;
  }
}

function DocxPreview({
  documentId,
  fileName,
  highlightSnippet,
}: {
  documentId: number | string;
  fileName?: string;
  highlightSnippet?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadDocx = async () => {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);
        containerRef.current.innerHTML = '';

        const response = await fetch(`/api/knowledge/documents/${documentId}/preview-stream`);
        if (!response.ok) {
          throw new Error(`Word 预览加载失败: HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) {
          throw new Error('Word 文件为空');
        }

        const { renderAsync } = await import('docx-preview');
        if (disposed || !containerRef.current) return;

        await renderAsync(buffer, containerRef.current, containerRef.current, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
        });

        if (!disposed && containerRef.current) {
          highlightDocxSnippet(containerRef.current, highlightSnippet);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Word 预览加载失败');
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    loadDocx();

    return () => {
      disposed = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [documentId, highlightSnippet]);

  if (loading) {
    return (
      <div className="flex h-[72vh] items-center justify-center rounded-[20px] border border-[#E7EDF5] bg-[#FCFDFE]">
        <div className="flex flex-col items-center space-y-3 text-[#64748B]">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">正在加载 Word 预览...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return <PreviewFallback documentId={documentId} fileName={fileName} message={error} />;
  }

  return (
    <div className="overflow-auto rounded-[20px] border border-[#E7EDF5] bg-[#F5F7FB] p-5">
      <div
        ref={containerRef}
        className="min-h-[72vh] [&_.docx-preview-wrapper]:flex [&_.docx-preview-wrapper]:justify-center [&_.docx-preview-wrapper]:py-4 [&_.docx-preview]:mx-auto [&_.docx-preview]:max-w-full [&_.docx-preview]:overflow-auto [&_.docx-preview_>section]:mx-auto [&_.docx-preview_>section]:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
      />
    </div>
  );
}

export default function DocumentPreview({
  documentId,
  fileName,
  format,
  className = '',
  highlightSnippet,
}: DocumentPreviewProps) {
  const normalizedFormat = (format || '').toLowerCase();

  if (normalizedFormat === 'pdf') {
    return <PdfPreview documentId={documentId} fileName={fileName} highlightSnippet={highlightSnippet} />;
  }

  if (normalizedFormat === 'docx') {
    return <DocxPreview documentId={documentId} fileName={fileName} highlightSnippet={highlightSnippet} />;
  }

  if (normalizedFormat === 'doc') {
    return (
      <PreviewFallback
        documentId={documentId}
        fileName={fileName}
        message="旧版 Word（.doc）暂不支持页内预览，请下载后查看。"
      />
    );
  }

  return (
    <div className={`flex h-[72vh] flex-col items-center justify-center rounded-[20px] border border-[#E7EDF5] bg-[#FCFDFE] px-6 text-center ${className}`}>
      <FileText className="mb-3 h-10 w-10 text-[#94A3B8]" />
      <p className="text-sm text-[#64748B]">当前文档格式暂不支持页内预览。</p>
      <button
        onClick={() => downloadKnowledgeDocument(documentId, fileName)}
        className="mt-4 inline-flex items-center rounded-full bg-[#F1F5FA] px-4 py-2 text-sm text-[#415168] transition-colors hover:bg-[#E2E8F0]"
      >
        <Download className="mr-2 h-4 w-4" />
        下载后查看
      </button>
    </div>
  );
}
