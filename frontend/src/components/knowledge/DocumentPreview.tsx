import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2 } from 'lucide-react';
import { downloadKnowledgeDocument } from '../../api';

interface DocumentPreviewProps {
  documentId: number | string;
  fileName?: string;
  format?: string;
  className?: string;
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

function PdfPreview({ documentId, fileName }: { documentId: number | string; fileName?: string }) {
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

        objectUrl = URL.createObjectURL(blob);
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
  }, [documentId]);

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

function DocxPreview({ documentId, fileName }: { documentId: number | string; fileName?: string }) {
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
  }, [documentId]);

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
}: DocumentPreviewProps) {
  const normalizedFormat = (format || '').toLowerCase();

  if (normalizedFormat === 'pdf') {
    return <PdfPreview documentId={documentId} fileName={fileName} />;
  }

  if (normalizedFormat === 'docx') {
    return <DocxPreview documentId={documentId} fileName={fileName} />;
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
