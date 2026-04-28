import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  PanelRightClose,
  PanelRightOpen,
  FileIcon,
  ExternalLink,
  ArrowRight,
  BookOpen,
  ShieldCheck,
  User,
  Maximize2,
  MessageSquare,
  Plus,
  Trash2,
  Search,
  Clock,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import {
  fetchRecommendedQuestions,
  fetchKnowledgeTopics,
  fetchKnowledgeDocuments,
  fetchChatSessions,
  fetchChatMessages,
  createChatSession,
  deleteChatSession,
  type DocSource,
  type ChatSession,
} from '../api';

// ==================== 类型定义 ====================

interface Message {
  id: number;
  role: 'user' | 'ai';
  content: string;
  references?: { id: string; title: string; page?: number }[];
  isGenerating?: boolean;  // 是否正在生成中
}








/** 聊天气泡内 Markdown 轻量渲染（无第三方依赖）：**粗体**、*斜体*、无序/有序列表、标题、水平线、引用、换行；先转义 HTML 防 XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatChatInline(text: string): string {
  let s = escapeHtml(text);
  // 粗体：**text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-[#4A362C]">$1</strong>');
  // 斜体：*text*
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em class="italic text-[#5A4D43]">$1</em>');
  // 高亮：==text==
  s = s.replace(/==([^=]+)==/g, '<mark class="bg-yellow-100 text-[#5C4D43] px-0.5 rounded">$1</mark>');
  // 链接：[text](url) - 仅显示文本，禁用跳转
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="text-[#C19A83] underline">$1</span>');
  return s;
}

// 检测是否为标题行
function isHeaderLine(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    return { level: match[1].length, text: match[2] };
  }
  return null;
}

// 检测是否为水平线
function isHrLine(line: string): boolean {
  return /^\s*[-*_]{3,}\s*$/.test(line);
}

// 检测是否为引用行
function isQuoteLine(line: string): boolean {
  return line.trim().startsWith('>');
}

// 获取引用内容
function getQuoteContent(line: string): string {
  return line.replace(/^\s*>\s?/, '');
}

function renderChatMessageHtml(content: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  const blocks: string[] = [];
  let i = 0;
  let inQuote = false;
  let quoteLines: string[] = [];

  // 标题样式映射
  const headerStyles: Record<number, string> = {
    1: 'text-xl font-bold text-[#4A362C] mt-4 mb-2 pb-1 border-b border-[#EADDD5]',
    2: 'text-lg font-semibold text-[#5A4D43] mt-3 mb-2',
    3: 'text-base font-semibold text-[#5C4D43] mt-2 mb-1',
    4: 'text-sm font-semibold text-[#5C4D43] mt-2',
    5: 'text-sm font-medium text-[#8C7A6B] mt-2',
    6: 'text-xs font-medium text-[#8C7A6B] mt-1',
  };

  // 检测是否为 Markdown 表格行
  const isTableRow = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
    // 排除分隔行（如 |------|------|）
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) return false;
    return true;
  };

  // 检测是否为表格分隔行
  const isTableSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    return /^\|[\s\-:|]+\|$/.test(trimmed);
  };

  // 解析并渲染表格
  const renderTable = (tableLines: string[]): string => {
    const rows = tableLines
      .filter(line => !isTableSeparator(line))
      .map(line => {
        const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        return cells.map(cell => formatChatInline(cell.trim()));
      });

    if (rows.length < 2) return tableLines.map(line => `<p>${formatChatInline(line)}</p>`).join('');

    const headerRow = rows[0];
    const bodyRows = rows.slice(1);

    const thead = `<thead class="bg-gradient-to-r from-[#F9F5F2] to-[#FDF9F6]">${headerRow.map(cell => `<th class="px-3 py-2 text-left text-xs font-semibold text-[#5C4D43]">${cell}</th>`).join('')}</thead>`;
    const tbody = `<tbody class="divide-y divide-[#EADDD5]">${bodyRows.map(row => `<tr class="hover:bg-[#FAF6F3]">${row.map(cell => `<td class="px-3 py-2 text-sm text-[#5C4D43]">${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;

    return `<div class="overflow-x-auto my-3"><table class="w-full text-sm border border-[#EADDD5] rounded-lg overflow-hidden">${thead}${tbody}</table></div>`;
  };

  while (i < lines.length) {
    const line = lines[i];

    // 检测表格开始
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      // 收集表格所有行
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(tableLines));
      continue;
    }

    // 处理水平分隔线
    if (isHrLine(line)) {
      // 关闭可能打开的引用块
      if (inQuote && quoteLines.length > 0) {
        blocks.push(`<blockquote class="border-l-4 border-[#C19A83] pl-4 py-2 my-3 bg-[#FDF9F6] rounded-r-lg text-[#5C4D43] italic">${quoteLines.map(l => formatChatInline(l)).join('<br/>')}</blockquote>`);
        quoteLines = [];
        inQuote = false;
      }
      blocks.push('<div class="border-t border-[#EADDD5] my-4"></div>');
      i += 1;
      continue;
    }

    // 处理引用块
    if (isQuoteLine(line)) {
      quoteLines.push(getQuoteContent(line));
      inQuote = true;
      i += 1;
      // 检查下一行是否仍是引用
      while (i < lines.length && isQuoteLine(lines[i])) {
        quoteLines.push(getQuoteContent(lines[i]));
        i += 1;
      }
      // 输出引用块
      blocks.push(`<blockquote class="border-l-4 border-[#C19A83] pl-4 py-2 my-3 bg-[#FDF9F6] rounded-r-lg text-[#5C4D43] italic">${quoteLines.map(l => formatChatInline(l)).join('<br/>')}</blockquote>`);
      quoteLines = [];
      inQuote = false;
      continue;
    }

    // 关闭可能打开的引用块
    if (inQuote) {
      blocks.push(`<blockquote class="border-l-4 border-[#C19A83] pl-4 py-2 my-3 bg-[#FDF9F6] rounded-r-lg text-[#5C4D43] italic">${quoteLines.map(l => formatChatInline(l)).join('<br/>')}</blockquote>`);
      quoteLines = [];
      inQuote = false;
    }

    // 处理标题
    const headerInfo = isHeaderLine(line);
    if (headerInfo) {
      const { level, text } = headerInfo;
      const style = headerStyles[level] || headerStyles[6];
      blocks.push(`<h${level} class="${style}">${formatChatInline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    // 处理无序列表
    const ulMatch = /^\s*[*-]\s+(.+)$/.exec(line);
    const olMatch = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*[*-]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        // 检查是否有任务列表 -[ ] 或 -[x]
        const taskMatch = m[1].match(/^-\s*\[([ x])\]\s*(.+)$/);
        if (taskMatch) {
          const checked = taskMatch[1] === 'x';
          items.push(`<li class="pl-0.5 flex items-start gap-2">${checked ? '<input type="checkbox" checked disabled class="mt-1 w-3.5 h-3.5 accent-[#C19A83] shrink-0" />' : '<input type="checkbox" disabled class="mt-1 w-3.5 h-3.5 accent-[#C19A83] shrink-0" />'}<span class="${checked ? 'line-through text-[#A89F95]' : ''}">${formatChatInline(taskMatch[2])}</span></li>`);
        } else {
          items.push(`<li class="pl-0.5">${formatChatInline(m[1])}</li>`);
        }
        i += 1;
      }
      blocks.push(
        `<ul class="list-disc pl-5 my-2 space-y-1 marker:text-[#C19A83] marker:font-bold">${items.join('')}</ul>`
      );
      continue;
    }
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push(`<li class="pl-0.5">${formatChatInline(m[1])}</li>`);
        i += 1;
      }
      blocks.push(
        `<ol class="list-decimal pl-5 my-2 space-y-1 marker:text-[#C19A83] marker:font-medium">${items.join('')}</ol>`
      );
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 普通段落 - 收集连续的非列表行
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isHeaderLine(lines[i]) && !isHrLine(lines[i]) && !isQuoteLine(lines[i]) && !isTableRow(lines[i]) && !isTableSeparator(lines[i]) && !/^\s*[*-]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      const para = paraLines.map((l) => formatChatInline(l)).join('<br/>');
      blocks.push(`<p class="my-2 first:mt-0 last:mb-0 leading-relaxed">${para}</p>`);
    }
  }

  // 关闭可能未关闭的引用块
  if (inQuote && quoteLines.length > 0) {
    blocks.push(`<blockquote class="border-l-4 border-[#C19A83] pl-4 py-2 my-3 bg-[#FDF9F6] rounded-r-lg text-[#5C4D43] italic">${quoteLines.map(l => formatChatInline(l)).join('<br/>')}</blockquote>`);
  }

  return blocks.join('');
}

// ==================== 主页面组件 ====================

export default function ChatPage() {
  const navigate = useNavigate();
  
  // 动态数据状态（从后端 API 加载）
  const [messages, setMessages] = useState<Message[]>([]);
  const [docSources, setDocSources] = useState<DocSource[]>([]);
  const [recommendedQuestions, setRecommendedQuestions] = useState<string[]>([]);
  // 上下文/数据来源：动态显示当前对话使用的知识库范围（初始为空，动态加载）
  const [contextSources, setContextSources] = useState<string[]>([]);

  // 其他状态
  const [inputText, setInputText] = useState('');
  const [highlightedDocId, setHighlightedDocId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentSessionId, setCurrentSessionId] = useState<number | string | null>(null);
  
  // 会话列表侧边栏相关状态
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true); // 默认加载中
  const [sessionSearchText, setSessionSearchText] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // 侧边栏折叠状态
  const [rightPanelVisible, setRightPanelVisible] = useState(true); // 右侧知识清单面板可见性
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 流式渲染：用 ref 直接写 DOM，绕过 React 批处理
  const streamingContentRef = useRef('');
  const streamingDivRef = useRef<HTMLDivElement | null>(null);
  const streamingMsgIdRef = useRef<number | null>(null);  // 追踪当前流式消息 ID

  // 加载初始数据（仅在组件挂载时执行一次）
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        // 并行加载所有数据（知识相关 + 聊天会话同时请求）
        // 每个 API 单独 try-catch，确保一个失败不影响其他

        // 推荐问题（可能返回 500，使用默认值兜底）
        let questionsData: any = [];
        try {
          // 不传 ai_mode 参数，后端默认返回 ai_mode='all' 的问题
          const questionsRes = await fetchRecommendedQuestions();
          if (questionsRes && questionsRes.length > 0) {
            const seen = new Set<string>();
            questionsData = questionsRes
              .map((q: any) => q.question || q)
              .filter((q: string) => {
                if (seen.has(q)) return false;
                seen.add(q);
                return true;
              });
          }
        } catch (e) {
          console.warn('加载推荐问题失败，使用默认值:', e);
        }

        // 知识主题
        try {
          await fetchKnowledgeTopics();
        } catch (e) {
          console.warn('加载知识主题失败:', e);
        }

        // 文档列表
        let docsData: any = { documents: [] };
        try {
          docsData = await fetchKnowledgeDocuments({ limit: 10 });
        } catch (e) {
          console.warn('加载文档列表失败:', e);
        }

        // 会话列表
        let sessionsData: any = { sessions: [] };
        try {
          sessionsData = await fetchChatSessions({ limit: 20 });
        } catch (e) {
          console.warn('加载会话列表失败:', e);
        }

        // 处理推荐问题（去重 + 保序）
        if (questionsData.length > 0) {
          setRecommendedQuestions(questionsData);
        }

        // 处理文档列表
        if (docsData?.documents && docsData.documents.length > 0) {
          const mappedDocs: DocSource[] = docsData.documents.map((doc: any) => ({
            id: String(doc.id),
            title: doc.title,
            type: doc.format as 'pdf' | 'word' | 'md' | 'txt',
            topic: doc.topic?.topicName || '',
            subTopic: doc.subTopic?.subTopicName || '',
          }));
          setDocSources(mappedDocs);
        }

        // 处理聊天会话（会话和消息并行加载）
        // 保存会话列表供侧边栏使用
        const sessions = sessionsData?.sessions || [];
        setSessions(sessions);

        if (sessions && sessions.length > 0) {
          // 优先从 localStorage 恢复上次选中的会话
          const savedSessionId = localStorage.getItem('vis4srd-chat-session-id');
          let targetSession = sessions.find((s: ChatSession) => String(s.id) === String(savedSessionId));

          // 如果没有保存的会话或找不到，选取最新会话
          if (!targetSession) {
            targetSession = sessions[0];
          }

          setCurrentSessionId(targetSession.id);
          // 保存会话 ID 到 localStorage
          localStorage.setItem('vis4srd-chat-session-id', String(targetSession.id));

          // 确保 sessionId 是数字类型
          const sessionIdNum = Number(targetSession.id);
          console.log('[ChatPage] 恢复会话:', { savedSessionId, targetSessionId: targetSession.id, sessionIdNum });

          // 消息加载与 UI 更新并行执行
          try {
            const msgsRes = await fetchChatMessages(sessionIdNum);
            console.log('[ChatPage] 加载消息结果:', { sessionId: sessionIdNum, messageCount: msgsRes?.length || 0 });
            if (msgsRes && msgsRes.length > 0) {
                const mappedMsgs: Message[] = msgsRes.map((m: any) => ({
                id: m.id,
                role: m.role as 'user' | 'ai',
                content: m.content,
                references: m.references ?? m.referencesJson,
              }));
              setMessages(mappedMsgs);

              // 从历史消息中恢复 docSources 和 contextSources 状态
              // 遍历所有 AI 消息，收集最新的 references 和 retrieval_sources
              const collectedDocSources: DocSource[] = [];
              const collectedContextSources: string[] = [];
              for (const msg of msgsRes) {
                if (msg.role === 'ai') {
                  // 从 references 字段恢复文档来源（支持 snake_case 和 camelCase）
                  const refs = msg.references ?? msg.referencesJson;
                  if (Array.isArray(refs) && refs.length > 0) {
                    for (const ref of refs) {
                      if (typeof ref === 'object' && ref !== null) {
                        const docId = String(ref.id || ref.title || '');
                        if (docId && !collectedDocSources.find(d => d.id === docId)) {
                          collectedDocSources.push({
                            id: docId,
                            title: ref.title || '',
                            type: (ref.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
                            topic: ref.topic || '',
                            subTopic: ref.subTopic || '',
                          });
                        }
                      }
                    }
                  }
                  // 从 retrieval_sources / retrievalSources 字段恢复（备用来源）
                  const sources = msg.retrievalSources ?? msg.retrieval_sources;
                  if (Array.isArray(sources) && sources.length > 0) {
                    for (const src of sources) {
                      if (typeof src === 'object' && src !== null) {
                        const docId = String(src.id || src.title || '');
                        if (docId && !collectedDocSources.find(d => d.id === docId)) {
                          collectedDocSources.push({
                            id: docId,
                            title: src.title || '',
                            type: (src.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
                            topic: src.topic || '',
                            subTopic: src.subTopic || '',
                          });
                        }
                      }
                    }
                  }
                  // 从 rag_context / ragContext 恢复上下文来源描述（如果有）
                  const ragCtx = msg.ragContext ?? msg.rag_context;
                  if (ragCtx && typeof ragCtx === 'object' && !Array.isArray(ragCtx)) {
                    const ctx = ragCtx as any;
                    if (ctx.used_documents && Array.isArray(ctx.used_documents)) {
                      for (const docName of ctx.used_documents) {
                        const docNameStr = String(docName);
                        if (docNameStr && !collectedContextSources.includes(docNameStr)) {
                          collectedContextSources.push(docNameStr);
                        }
                      }
                    }
                    if (ctx.sources && Array.isArray(ctx.sources)) {
                      for (const src of ctx.sources) {
                        const srcStr = String(src);
                        if (srcStr && !collectedContextSources.includes(srcStr)) {
                          collectedContextSources.push(srcStr);
                        }
                      }
                    }
                  }
                }
              }
              if (collectedDocSources.length > 0) {
                console.log('[ChatPage] 从历史消息恢复文档来源:', collectedDocSources.length, '个');
                setDocSources(collectedDocSources);
              }
              if (collectedContextSources.length > 0) {
                setContextSources(collectedContextSources);
              }
            } else {
              setMessages([]);
            }
          } catch (msgErr) {
            console.error('[ChatPage] 加载消息失败:', msgErr);
            setMessages([]);
          }
        } else {
          setMessages([]);
          setCurrentSessionId(null);
          localStorage.removeItem('vis4srd-chat-session-id');
        }
      } catch (err) {
        console.warn('加载聊天数据失败，使用默认值:', err);
        setMessages([]);
        setSessions([]);
      } finally {
        setIsLoading(false);
        setSessionsLoading(false);
      }
    };

    loadInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在组件挂载时执行一次

  // 切换会话
  const switchSession = async (session: ChatSession) => {
    if (String(session.id) === String(currentSessionId)) return;
    
    setCurrentSessionId(session.id);
    localStorage.setItem('vis4srd-chat-session-id', String(session.id));
    
    // 清空 RAG 相关数据
    setDocSources([]);
    setContextSources([]);
    
    // 加载新会话的消息
    setIsLoading(true);
    try {
      const msgsRes = await fetchChatMessages(session.id);
      if (msgsRes && msgsRes.length > 0) {
        const mappedMsgs: Message[] = msgsRes.map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'ai',
          content: m.content,
          references: m.references ?? m.referencesJson,
        }));
        setMessages(mappedMsgs);

        // 从历史消息中恢复 docSources 和 contextSources 状态
        const collectedDocSources: DocSource[] = [];
        const collectedContextSources: string[] = [];
        for (const msg of msgsRes) {
          if (msg.role === 'ai') {
            // 从 references 字段恢复文档来源（支持 snake_case 和 camelCase）
            const refs = msg.references ?? msg.referencesJson;
            if (Array.isArray(refs) && refs.length > 0) {
              for (const ref of refs) {
                if (typeof ref === 'object' && ref !== null) {
                  const docId = String(ref.id || ref.title || '');
                  if (docId && !collectedDocSources.find(d => d.id === docId)) {
                    collectedDocSources.push({
                      id: docId,
                      title: ref.title || '',
                      type: (ref.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
                      topic: ref.topic || '',
                      subTopic: ref.subTopic || '',
                    });
                  }
                }
              }
            }
            // 从 retrieval_sources / retrievalSources 字段恢复（备用来源）
            const sources = msg.retrievalSources ?? msg.retrieval_sources;
            if (Array.isArray(sources) && sources.length > 0) {
              for (const src of sources) {
                if (typeof src === 'object' && src !== null) {
                  const docId = String(src.id || src.title || '');
                  if (docId && !collectedDocSources.find(d => d.id === docId)) {
                    collectedDocSources.push({
                      id: docId,
                      title: src.title || '',
                      type: (src.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
                      topic: src.topic || '',
                      subTopic: src.subTopic || '',
                    });
                  }
                }
              }
            }
            // 从 rag_context / ragContext 恢复上下文来源描述
            const ragCtx = msg.ragContext ?? msg.rag_context;
            if (ragCtx && typeof ragCtx === 'object' && !Array.isArray(ragCtx)) {
              const ctx = ragCtx as any;
              if (ctx.used_documents && Array.isArray(ctx.used_documents)) {
                for (const docName of ctx.used_documents) {
                  const docNameStr = String(docName);
                  if (docNameStr && !collectedContextSources.includes(docNameStr)) {
                    collectedContextSources.push(docNameStr);
                  }
                }
              }
              if (ctx.sources && Array.isArray(ctx.sources)) {
                for (const src of ctx.sources) {
                  const srcStr = String(src);
                  if (srcStr && !collectedContextSources.includes(srcStr)) {
                    collectedContextSources.push(srcStr);
                  }
                }
              }
            }
          }
        }
        if (collectedDocSources.length > 0) {
          setDocSources(collectedDocSources);
        }
        if (collectedContextSources.length > 0) {
          setContextSources(collectedContextSources);
        }
      } else {
        setMessages([]);
        setDocSources([]);
        setContextSources([]);
      }
    } catch (err) {
      console.error('切换会话失败:', err);
      setMessages([]);
      setDocSources([]);
      setContextSources([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 创建新会话
  const handleCreateNewSession = async () => {
    try {
      const newSession = await createChatSession({
        aiMode: 'deep_think',
        contextType: 'general',
      });

      // 更新会话列表（添加到最前面）
      setSessions(prev => [newSession, ...prev]);

      // 切换到新会话
      setCurrentSessionId(newSession.id);
      localStorage.setItem('vis4srd-chat-session-id', String(newSession.id));
      setMessages([]);
      
      // 清空 RAG 相关数据
      setDocSources([]);
      setContextSources([]);
    } catch (err) {
      console.error('创建新会话失败:', err);
      alert('创建会话失败，请重试');
    }
  };

  // 删除会话
  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('确定要删除这个会话吗？删除后无法恢复。')) return;
    
    try {
      await deleteChatSession(sessionId);
      
      // 从列表中移除
      setSessions(prev => prev.filter(s => String(s.id) !== String(sessionId)));
      
      // 如果删除的是当前会话，切换到其他会话
      if (String(sessionId) === String(currentSessionId)) {
        const remaining = sessions.filter(s => String(s.id) !== String(sessionId));
        if (remaining.length > 0) {
          switchSession(remaining[0]);
        } else {
          setCurrentSessionId(null);
          setMessages([]);
          localStorage.removeItem('vis4srd-chat-session-id');
        }
      }
    } catch (err) {
      console.error('删除会话失败:', err);
      alert('删除会话失败，请重试');
    }
  };

  // 刷新会话列表
  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetchChatSessions({ limit: 20 });
      setSessions(res.sessions || []);
    } catch (err) {
      console.error('刷新会话列表失败:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  // 格式化会话时间
  const formatSessionTime = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 获取会话预览文本
  const getSessionPreview = (session: ChatSession) => {
    if (session.messageCount === 0) return '新会话';
    return `共 ${session.messageCount} 条消息`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 高亮闪烁定时器
  useEffect(() => {
    if (highlightedDocId) {
      const timer = setTimeout(() => {
        setHighlightedDocId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedDocId]);

  // 发送消息（流式，后端 SSE）
  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userContent = inputText.trim();

    const newUserMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: userContent,
    };
    setMessages(prev => [...prev, newUserMsg]);
    setInputText('');

    try {
      // 确保有活跃的会话
      let sessionId = currentSessionId;
      let sessionJustCreated = false;
      if (!sessionId) {
        const newSession = await createChatSession({
          aiMode: 'deep_think',
          contextType: 'general',
        });
        sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        localStorage.setItem('vis4srd-chat-session-id', String(sessionId));

        // 将新创建的会话添加到会话列表顶部
        setSessions(prev => [newSession, ...prev]);
        sessionJustCreated = true;
      }

      // 流式占位 AI 消息（内容初始为空，标记为正在生成）
      const aiMsgId = Date.now() + 1;
      streamingMsgIdRef.current = aiMsgId;  // 保存当前流式消息 ID
      const aiPlaceholder: Message = {
        id: aiMsgId,
        role: 'ai',
        content: '',
        isGenerating: true,
      };
      // 清空流式 ref
      streamingContentRef.current = '';

      setMessages(prev => [...prev, aiPlaceholder]);

      // 等待 DOM 更新完成后，再开始流式请求（解决竞态条件）
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          const aiDivs = document.querySelectorAll('[data-msg-id]');
          for (const div of aiDivs) {
            if (String((div as HTMLElement).dataset.msgId) === String(aiMsgId)) {
              const contentDiv = div.querySelector('[data-chat-body]') as HTMLDivElement | null;
              if (contentDiv) {
                streamingDivRef.current = contentDiv;
              }
              break;
            }
          }
          resolve();
        });
      });

      // ===== 开始流式请求 =====
      const endpoint = `/api/chat/sessions/${sessionId}/messages/stream`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({ content: userContent, aiMode: '深度思考' }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('浏览器不支持流式读取');

      const decoder = new TextDecoder();
      let buffer = '';
      let pendingContent = '';
      let pendingTimer: ReturnType<typeof setTimeout> | null = null;
      let lastRenderTime = 0;
      const BATCH_INTERVAL_MS = 150;
      let streamDone = false;
      let streamError: Error | null = null;

      const flushPendingContent = () => {
        pendingTimer = null;
        if (pendingContent.length === 0) return;
        const content = pendingContent;
        pendingContent = '';
        if (streamingDivRef.current) {
          streamingContentRef.current += content;
          // 使用 try-catch 防止渲染崩溃
          try {
            streamingDivRef.current.innerHTML = renderChatMessageHtml(streamingContentRef.current);
            const now = Date.now();
            if (now - lastRenderTime > 300) {
              lastRenderTime = now;
              const container = streamingDivRef.current.parentElement;
              if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            }
          } catch (renderErr) {
            console.error('[ChatPage] 渲染消息内容失败:', renderErr);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done || streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const text = line.trim();
          if (!text.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(text.slice(6));
            if (json.type === 'chunk') {
              pendingContent += json.content;
              if (!pendingTimer) pendingTimer = setTimeout(flushPendingContent, BATCH_INTERVAL_MS);
            } else if (json.type === 'done') {
              streamDone = true;
              if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
              if (pendingContent.length > 0 && streamingDivRef.current) {
                streamingContentRef.current += pendingContent;
                streamingDivRef.current.innerHTML = renderChatMessageHtml(streamingContentRef.current);
              }
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: streamingContentRef.current, isGenerating: false }
                  : m
              ));
              streamingMsgIdRef.current = null;
              streamingContentRef.current = '';
              streamingDivRef.current = null;
              if (!sessionJustCreated) refreshSessions();
            } else if (json.type === 'error') {
              streamDone = true;
              streamError = new Error(json.message);
              if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
              const errContent = streamingContentRef.current
                ? streamingContentRef.current + '\n\n[错误] ' + json.message
                : '[错误] ' + json.message;
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: errContent, isGenerating: false }
                  : m
              ));
              streamingMsgIdRef.current = null;
              streamingContentRef.current = '';
              streamingDivRef.current = null;
            } else if (json.type === 'rag_sources' && Array.isArray(json.sources)) {
              setDocSources((json.sources as any[]).map((s: any) => ({
                id: String(s.id || s.title),
                title: s.title,
                type: (s.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
                topic: s.topic || '',
                subTopic: s.subTopic || '',
              })));
            } else if (json.type === 'context_sources' && Array.isArray(json.sources)) {
              setContextSources(json.sources as string[]);
            }
          } catch {}
        }
      }

      // 兜底：刷新剩余未渲染内容
      if (!streamDone && pendingContent.length > 0 && streamingDivRef.current) {
        streamingContentRef.current += pendingContent;
        streamingDivRef.current.innerHTML = renderChatMessageHtml(streamingContentRef.current);
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, content: streamingContentRef.current, isGenerating: false }
            : m
        ));
        streamingMsgIdRef.current = null;
        streamingContentRef.current = '';
        streamingDivRef.current = null;
      }

      if (streamError) throw streamError;

    } catch (err) {
      console.error('发送消息失败:', err);
      const errorMsg: Message = {
        id: Date.now() + 1,
        role: 'ai',
        content: '抱歉，消息发送失败，请稍后重试。',
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 点击聊天记录中的文档引用 - 高亮对应文档
  const handleChatDocClick = (docId: string) => {
    setHighlightedDocId(docId);
  };

  // 点击右侧来源列表中的文档 - 全屏预览
  const handleSourceDocClick = (doc: DocSource) => {
    navigate(`/doc-preview?id=${doc.id}`);
  };

  // 全屏预览
  const handleFullScreenPreview = (doc: DocSource, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/doc-preview?id=${doc.id}`);
  };

  // 追溯到详情页
  const handleGoToDetail = (doc: DocSource, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/knowledge/detail?id=${doc.id}`);
  };

  return (
    <div className="flex flex-1 min-h-0 w-full">
      {/* 左侧会话列表侧边栏 - 抽屉式 */}
      <div className={`relative flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-[48px]' : 'w-[280px]'}`}>
        {/* 折叠/展开切换按钮 */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={`absolute top-1/2 -translate-y-1/2 z-10 w-6 h-16 bg-white border border-[#EADDD5] rounded-r-lg shadow-sm hover:bg-[#F4EBE1] transition-colors flex items-center justify-center ${
            sidebarCollapsed ? 'left-[48px]' : 'left-[280px]'
          }`}
          title={sidebarCollapsed ? '展开会话列表' : '收起会话列表'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4 text-[#8C7A6B]" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-[#8C7A6B]" />
          )}
        </button>

        {/* 侧边栏内容 */}
        <div className={`h-full border-r border-[#EADDD5] bg-[#FAF6F3] flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? 'w-[48px] opacity-0 pointer-events-none' : 'w-[280px] opacity-100'
        }`}>
          {/* 头部 */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-[#EADDD5] shrink-0 bg-white/50 backdrop-blur-sm">
            <div className="flex items-center space-x-2 text-[#4A362C] font-bold">
              <MessageSquare className="w-5 h-5 text-[#8C7A6B]" />
              {!sidebarCollapsed && <span>会话记录</span>}
            </div>
            <button
              onClick={handleCreateNewSession}
              className="p-1.5 hover:bg-[#EADDD5] rounded-lg transition-colors text-[#8C7A6B] hover:text-[#4A362C]"
              title="新建会话"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          
          {/* 搜索框 */}
          <div className="px-3 py-2 border-b border-[#EADDD5] shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A89F95]" />
              <input
                type="text"
                value={sessionSearchText}
                onChange={(e) => setSessionSearchText(e.target.value)}
                placeholder="搜索会话..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#EADDD5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D7BFA6] focus:border-[#C19A83]"
              />
            </div>
          </div>
          
          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto">
            {sessionsLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-[#EADDD5] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <MessageSquare className="w-12 h-12 text-[#D7BFA6] mb-3" />
                <p className="text-sm text-[#8C7A6B]">暂无会话记录</p>
                <p className="text-xs text-[#A89F95] mt-1">开始对话将自动创建</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {sessions
                  .filter(session => {
                    if (!sessionSearchText) return true;
                    const search = sessionSearchText.toLowerCase();
                    return (
                      session.sessionCode?.toLowerCase().includes(search) ||
                      session.aiMode?.toLowerCase().includes(search)
                    );
                  })
                  .map(session => (
                    <div
                      key={session.id}
                      onClick={() => switchSession(session)}
                      className={`group relative p-3 rounded-xl cursor-pointer transition-all ${
                        String(session.id) === String(currentSessionId)
                          ? 'bg-[#D7BFA6] shadow-sm'
                          : 'hover:bg-[#F4EBE1]'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <Clock className="w-3.5 h-3.5 text-[#8C7A6B] shrink-0" />
                            <span className="text-xs text-[#8C7A6B]">
                              {formatSessionTime(session.lastMessageAt || session.createdAt)}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              session.aiMode === 'deep_think' 
                                ? 'bg-[#EADDD5] text-[#5C4D43]'
                                : 'bg-blue-100 text-blue-600'
                            }`}>
                              {session.aiMode === 'deep_think' ? '深度思考' : session.aiMode}
                            </span>
                          </div>
                          <p className="text-sm text-[#5C4D43] mt-1 truncate">
                            {getSessionPreview(session)}
                          </p>
                        </div>
                        
                        {/* 删除按钮 */}
                        <button
                          onClick={(e) => handleDeleteSession(session.id as number, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#EADDD5] rounded transition-all"
                          title="删除会话"
                        >
                          <Trash2 className="w-4 h-4 text-[#8C7A6B] hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          
          {/* 底部操作 */}
          <div className="p-3 border-t border-[#EADDD5] shrink-0">
            <button
              onClick={refreshSessions}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5C4D43] rounded-xl text-sm transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span>刷新列表</span>
            </button>
          </div>
        </div>
      </div>
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden">

        {/* 消息滚动区域 */}
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-4 space-y-6 min-h-0">
          {/* 上下文/数据来源 - 动态显示 */}
          <div className="bg-[#F6EBE1] rounded-xl p-4 border border-[#EADDD5] shadow-sm mb-6 shrink-0">
            <div className="text-sm font-bold text-[#8C7A6B] mb-2">上下文/数据来源</div>
            <ul className="text-sm space-y-1 text-[#5C4D43] list-disc list-inside">
              {contextSources.length > 0 ? (
                contextSources.map((source, idx) => (
                  <li key={idx}>{source}</li>
                ))
              ) : (
                <li className="text-[#A89F95]">
                  开始对话后，上下文数据来源将显示在这里
                </li>
              )}
            </ul>
          </div>

          {/* 骨架屏加载状态 */}
          {isLoading && (
            <div className="space-y-6 animate-pulse">
              {/* AI 消息骨架 */}
              <div className="flex justify-start">
                <div className="w-8 h-8 rounded-full bg-[#EADDD5] mr-3 flex-shrink-0" />
                <div className="max-w-[70%] bg-white border border-[#EADDD5] rounded-2xl rounded-tl-sm p-4 space-y-3">
                  <div className="h-4 bg-[#EADDD5] rounded w-3/4" />
                  <div className="h-4 bg-[#EADDD5] rounded w-1/2" />
                </div>
              </div>
              {/* 用户消息骨架 */}
              <div className="flex justify-end">
                <div className="max-w-[70%] bg-[#D7BFA6] rounded-2xl rounded-tr-sm p-4 space-y-3">
                  <div className="h-4 bg-[#C19A83] rounded w-2/3" />
                </div>
                <div className="w-8 h-8 rounded-full bg-[#C19A83] ml-3 flex-shrink-0" />
              </div>
              {/* 提示文字 */}
              <div className="text-center text-sm text-[#8C7A6B]">
                正在加载聊天记录...
              </div>
            </div>
          )}

          {/* 空状态/欢迎消息 */}
          {!isLoading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 space-y-8">
              {/* AI 头像和欢迎语 */}
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#C19A83] to-[#8C7A6B] flex items-center justify-center shadow-lg mb-4">
                  <ShieldCheck className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-[#4A362C] mb-2">你好，我是智能心理助手</h2>
                <p className="text-[#8C7A6B] max-w-md">
                  我可以帮你解答心理健康相关问题，提供心理知识科普，解读量表结果，或进行风险评估对话。
                </p>
              </div>
              
              {/* 功能介绍卡片 */}
              <div className="grid grid-cols-3 gap-4 w-full max-w-3xl">
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-3">
                    <BookOpen className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-[#4A362C] mb-1">知识科普</h3>
                  <p className="text-sm text-[#8C7A6B]">了解心理健康知识，认识抑郁、焦虑等情绪</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-3">
                    <FileText className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-[#4A362C] mb-1">量表解读</h3>
                  <p className="text-sm text-[#8C7A6B]">解读PHQ-9、GAD-7等心理量表结果</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-[#EADDD5] shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-3">
                    <ShieldCheck className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-[#4A362C] mb-1">风险评估</h3>
                  <p className="text-sm text-[#8C7A6B]">了解自杀风险评估相关知识</p>
                </div>
              </div>
              
              {/* 推荐问题 */}
              {recommendedQuestions.length > 0 && (
                <div className="w-full max-w-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-[#C19A83]" />
                    <h3 className="font-semibold text-[#4A362C]">你可以问我</h3>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {recommendedQuestions.slice(0, 6).map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => setInputText(q)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#EADDD5] hover:border-[#C19A83] rounded-xl text-sm text-[#5C4D43] shadow-sm hover:shadow transition-all"
                      >
                        <span className="w-6 h-6 rounded-full bg-[#F4EBE1] text-[#8C7A6B] text-xs flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span>{q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 聊天历史 */}
          {!isLoading && messages.map(msg => (
            <div
              key={msg.id}
              data-msg-id={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-[#D7BFA6] flex items-center justify-center mr-3 flex-shrink-0 mt-1">
                  <ShieldCheck className="w-5 h-5 text-[#4A362C]" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-[#D7BFA6] text-[#4A362C] rounded-tr-sm'
                    : 'bg-white border border-[#EADDD5] text-[#5C4D43] rounded-tl-sm'
                }`}
              >
                {/* 正在生成中的温馨提示 - 只有当流式内容为空时才显示 */}
                {msg.role === 'ai' && msg.isGenerating && !streamingContentRef.current && (
                  <div className="flex items-center space-x-3 py-2">
                    <div className="flex space-x-1">
                      <span className="w-2 h-2 bg-[#C19A83] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-[#C19A83] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-[#C19A83] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-sm text-[#8C7A6B] italic">正在思考中，请稍等...</span>
                  </div>
                )}
                <div
                  data-chat-body=""
                  className="chat-md text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-[#4A362C] [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:pb-1 [&_h1]:border-b [&_h1]:border-[#EADDD5] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[#5A4D43] [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[#5C4D43] [&_h3]:mt-2 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[#5C4D43] [&_h4]:mt-2 [&_h5]:text-sm [&_h5]:font-medium [&_h5]:text-[#8C7A6B] [&_h5]:mt-2 [&_h6]:text-xs [&_h6]:font-medium [&_h6]:text-[#8C7A6B] [&_h6]:mt-1 [&_p]:my-2 [&_p]:leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:space-y-1 [&_li]:pl-0.5 [&_strong]:font-semibold [&_strong]:text-[#4A362C] [&_em]:italic [&_em]:text-[#5C4D43] [&_mark]:bg-yellow-100 [&_mark]:text-[#5C4D43] [&_mark]:px-0.5 [&_mark]:rounded"
                  dangerouslySetInnerHTML={{ __html: renderChatMessageHtml(msg.content) }}
                />

                {msg.references && msg.references.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-dashed border-[#EADDD5] flex items-center flex-wrap gap-2">
                    <span className="text-xs text-[#8C7A6B]">参考资料</span>
                    {msg.references.map((ref, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleChatDocClick(ref.id)}
                        className="flex items-center space-x-1 bg-[#F4EBE1] hover:bg-[#EADDD5] transition-colors px-2 py-1 rounded text-xs text-[#5C4D43] border border-[#D7BFA6]"
                      >
                        <FileText className="w-3 h-3" />
                        <span>[{idx + 1}]</span>
                        <span className="truncate max-w-[100px]">{ref.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[#8C7A6B] flex items-center justify-center ml-3 flex-shrink-0 mt-1 text-white">
                  <User className="w-5 h-5" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="p-6 pt-2 bg-gradient-to-t from-[#FAF6F3] to-transparent shrink-0">
          <div className="mb-4">
            <div className="text-sm font-bold text-[#8C7A6B] mb-2">推荐问题</div>
            <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {recommendedQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => setInputText(q)}
                  className="whitespace-nowrap px-4 py-2 bg-white border border-[#EADDD5] hover:border-[#D7BFA6] rounded-full text-sm text-[#5C4D43] shadow-sm flex items-center space-x-1 transition-colors"
                >
                  <span>· {q}</span>
                  <ArrowRight className="w-3 h-3 text-[#8C7A6B]" />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#FCF9F7] rounded-3xl border border-[#EADDD5] shadow-sm p-4 focus-within:ring-1 focus-within:ring-[#D7BFA6] transition-all">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请输入你的问题跟我聊聊~"
              className="w-full bg-transparent border-none focus:outline-none resize-none text-[#4A362C] placeholder-[#A89F95] min-h-[44px] text-sm"
              rows={1}
            />

            <div className="flex justify-end items-center mt-4">
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className="bg-[#C19A83] hover:bg-[#A07D6B] disabled:bg-[#EADDD5] disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-full text-sm font-semibold transition-colors shadow-sm tracking-widest"
              >
                发送
              </button>
            </div>
          </div>
          <div className="text-center mt-3 text-xs text-[#A89F95]">
            说明：内容为 AI 生成，请辨别
          </div>
        </div>
      </div>

      {/* 展开右侧知识清单面板按钮（面板收起时显示） */}
      {!rightPanelVisible && (
        <button
          onClick={() => setRightPanelVisible(true)}
          className="fixed top-24 right-4 z-30 flex items-center gap-2 px-3 py-2 bg-white border border-[#EADDD5] rounded-xl shadow-md hover:shadow-lg hover:bg-[#FAF6F3] transition-all text-sm text-[#4A362C] font-medium"
          title="展开知识清单"
        >
          <PanelRightOpen className="w-4 h-4" />
          知识清单
        </button>
      )}

      {/* 右侧面板（知识清单，可折叠） */}
      {rightPanelVisible && (
      <div
        className="w-[320px] lg:w-[360px] xl:w-[400px] border-l border-[#EADDD5] bg-[#FAF6F3] flex flex-col shrink-0"
      >
        <div className="h-14 flex items-center px-4 border-b border-[#EADDD5] shrink-0 bg-white/50 backdrop-blur-sm">
          <button
            onClick={() => setRightPanelVisible(false)}
            className="flex items-center space-x-2 text-[#4A362C] font-bold hover:text-orange-500 transition-colors cursor-pointer"
            title="收起知识清单"
          >
            <PanelRightClose className="w-5 h-5" />
            <span>知识清单</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
          {/* 来源文档列表 */}
          <section>
            <h3 className="text-sm font-bold text-[#4A362C] mb-3 flex justify-between items-center">
              <span>来源文档列表</span>
              <span className="text-xs font-normal text-[#8C7A6B] bg-[#EADDD5] px-2 py-0.5 rounded">
                点击操作
              </span>
            </h3>
            <div className="bg-white rounded-xl border border-[#EADDD5] shadow-sm overflow-hidden">
              {isLoading ? (
                <div className="p-8 text-center text-[#8C7A6B]">
                  <div className="w-8 h-8 mx-auto mb-3 border-2 border-[#C19A83] border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm">加载中...</p>
                </div>
              ) : docSources.length > 0 ? (
                <>
                  {docSources.map((doc, idx) => (
                    <div
                      key={doc.id}
                      className={`p-3 transition-colors ${
                        highlightedDocId === doc.id
                          ? 'bg-[#FEF3CD] animate-pulse'
                          : idx !== docSources.length - 1
                            ? 'border-b border-[#F4EBE1] hover:bg-[#F4EBE1]'
                            : 'hover:bg-[#F4EBE1]'
                      }`}
                    >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center space-x-3 overflow-hidden cursor-pointer"
                      onClick={() => handleSourceDocClick(doc)}
                    >
                      <div className="bg-[#FAF6F3] p-2 rounded-lg text-[#A07D6B]">
                        <FileIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-[#5C4D43] truncate font-medium">
                          来源{idx + 1}: {doc.title}
                        </div>
                        <div className="text-xs text-[#A89F95]">
                          {doc.topic} · {doc.subTopic}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      {/* 全屏预览按钮 */}
                      <button
                        onClick={(e) => handleFullScreenPreview(doc, e)}
                        className="p-1.5 hover:bg-[#EADDD5] rounded transition-colors text-[#8C7A6B]"
                        title="全屏预览"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      {/* 追溯到详情页按钮 */}
                      <button
                        onClick={(e) => handleGoToDetail(doc, e)}
                        className="p-1.5 hover:bg-[#EADDD5] rounded transition-colors text-[#8C7A6B]"
                        title="追溯到详情页"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                ))}
                </>
              ) : docSources.length === 0 ? (
                <div className="p-8 text-center text-[#8C7A6B]">
                  <p className="text-sm">暂无文档来源</p>
                  <p className="text-xs mt-1">开始对话后，相关文档来源将自动显示在这里</p>
                </div>
              ) : null}
            </div>
          </section>

        </div>
      </div>
      )}
    </div>
  );
}