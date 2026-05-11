import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Copy,
  FileText,
  GitBranch,
  GripVertical,
  Archive,
  Mic,
  MoreHorizontal,
  Network,
  Pin,
  PenSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  Plus,
  RefreshCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import {
  createChatSession,
  deleteChatSession,
  fetchChatMessages,
  fetchChatSessions,
  sendChatMessageStream,
  type ChatSession,
  type ChatMessage,
  updateChatSession,
} from '../api';

interface ReferenceItem {
  id: string;
  title: string;
  type?: string;
}

interface EvidenceItem {
  id: string;
  title: string;
  sourceType: string;
  snippet: string;
  claim: string;
  docId?: string;
}

interface EvidenceGroup {
  id: string;
  title: string;
  sourceType: string;
  docId?: string;
  items: EvidenceItem[];
}

interface MindMapNode {
  id: string;
  label: string;
  group: 'question' | 'core' | 'support' | 'action';
  description: string;
  relatedEvidenceIds?: string[];
}

interface MindMapEdge {
  source: string;
  target: string;
  label?: string;
}

interface MindMapPayload {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  summary: string;
  focusNodeId?: string;
}

interface KnowledgePanelPayload {
  mindMap: MindMapPayload;
  tableRows: Array<{ topic: string; knowledge: string; description: string }>;
  followUpQuestions: string[];
}

interface MessageViewModel {
  id: number | string;
  role: 'user' | 'ai';
  content: string;
  references: ReferenceItem[];
  evidenceList?: EvidenceItem[];
  knowledgePanel?: KnowledgePanelPayload;
  contextSources?: string[];
  modeLabel?: string;
  durationLabel?: string;
  isGenerating?: boolean;
  feedback?: 'up' | 'down' | null;
  createdAt?: string;
}

interface StreamingUiState {
  startedAt: number;
  displayedContent: string;
  fullContent: string;
  queuedChars: string[];
  streamDone: boolean;
  timerId: number | null;
  typingTimerId: number | null;
  onBeforeFinish?: (message: MessageViewModel) => void;
}

interface SessionListItem {
  id: number;
  title: string;
  preview: string;
  groupLabel: string;
  rawTitle?: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  messageCount: number;
  aiMode: ChatSession['aiMode'];
  isPinned: boolean;
  status: ChatSession['status'];
}

const CHAT_LAYOUT_LEFT_LS = 'vis4srd_chat_layout_left_px';
const CHAT_LAYOUT_RIGHT_LS = 'vis4srd_chat_layout_right_px';
const CHAT_LAYOUT_LEFT_PCT_LS = 'vis4srd_chat_layout_left_pct';
const CHAT_LAYOUT_RIGHT_PCT_LS = 'vis4srd_chat_layout_right_pct';
/** 设计稿比例：会话列表 18%、对话区 52%、知识清单 25%（相对三栏之和 95%，另 ~5% 为全局导航） */
const CHAT_LAYOUT_LEFT_RATIO = 18 / 95;
const CHAT_LAYOUT_RIGHT_RATIO = 25 / 95;
const CHAT_LAYOUT_LEFT_MIN = 200;
const CHAT_LAYOUT_RIGHT_MIN = 200;
const CHAT_LAYOUT_MAX_COL = 560;
const CHAT_LAYOUT_MIN_CENTER = 320;
const CHAT_LAYOUT_CHROME = 88;

function readLayoutRatios(): { left: number; right: number } {
  try {
    const ls = localStorage.getItem(CHAT_LAYOUT_LEFT_PCT_LS);
    const rs = localStorage.getItem(CHAT_LAYOUT_RIGHT_PCT_LS);
    if (ls !== null && rs !== null) {
      const l = parseFloat(ls);
      const r = parseFloat(rs);
      if (Number.isFinite(l) && Number.isFinite(r) && l >= 0.12 && r >= 0.12 && l + r <= 0.72) {
        return { left: l, right: r };
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const oldL = parseInt(localStorage.getItem(CHAT_LAYOUT_LEFT_LS) || '', 10);
    const oldR = parseInt(localStorage.getItem(CHAT_LAYOUT_RIGHT_LS) || '', 10);
    if (Number.isFinite(oldL) && Number.isFinite(oldR) && typeof window !== 'undefined') {
      const est = Math.max(720, window.innerWidth - 260);
      return {
        left: Math.min(0.34, Math.max(0.14, oldL / est)),
        right: Math.min(0.38, Math.max(0.15, oldR / est)),
      };
    }
  } catch {
    /* ignore */
  }
  return { left: CHAT_LAYOUT_LEFT_RATIO, right: CHAT_LAYOUT_RIGHT_RATIO };
}

function resolveChatColumnWidths(totalWidth: number, leftRatio: number, rightRatio: number): { leftW: number; rightW: number } {
  if (totalWidth <= CHAT_LAYOUT_MIN_CENTER + CHAT_LAYOUT_CHROME + CHAT_LAYOUT_LEFT_MIN + CHAT_LAYOUT_RIGHT_MIN) {
    return { leftW: CHAT_LAYOUT_LEFT_MIN, rightW: CHAT_LAYOUT_RIGHT_MIN };
  }
  let leftW = Math.round(totalWidth * leftRatio);
  let rightW = Math.round(totalWidth * rightRatio);
  leftW = Math.min(CHAT_LAYOUT_MAX_COL, Math.max(CHAT_LAYOUT_LEFT_MIN, leftW));
  rightW = Math.min(CHAT_LAYOUT_MAX_COL, Math.max(CHAT_LAYOUT_RIGHT_MIN, rightW));
  let center = totalWidth - leftW - rightW - CHAT_LAYOUT_CHROME;
  let guard = 0;
  while (center < CHAT_LAYOUT_MIN_CENTER && guard < 640 && (leftW > CHAT_LAYOUT_LEFT_MIN || rightW > CHAT_LAYOUT_RIGHT_MIN)) {
    if (leftW >= rightW && leftW > CHAT_LAYOUT_LEFT_MIN) leftW -= 1;
    else if (rightW > CHAT_LAYOUT_RIGHT_MIN) rightW -= 1;
    else if (leftW > CHAT_LAYOUT_LEFT_MIN) leftW -= 1;
    center = totalWidth - leftW - rightW - CHAT_LAYOUT_CHROME;
    guard += 1;
  }
  return { leftW, rightW };
}

/** 底部输入区整体高度（白卡片），避免占满屏幕挡住历史消息 */
const CHAT_INPUT_DOCK_HEIGHT_LS = 'vis4srd_chat_input_dock_height_px';
const CHAT_INPUT_DOCK_DEFAULT = 220;
const CHAT_INPUT_DOCK_MIN = 152;
const CHAT_INPUT_DOCK_MAX = 520;

function readStoredInputDockHeight(): number {
  try {
    const n = parseInt(localStorage.getItem(CHAT_INPUT_DOCK_HEIGHT_LS) || '', 10);
    if (!Number.isFinite(n)) return CHAT_INPUT_DOCK_DEFAULT;
    return Math.min(CHAT_INPUT_DOCK_MAX, Math.max(CHAT_INPUT_DOCK_MIN, n));
  } catch {
    return CHAT_INPUT_DOCK_DEFAULT;
  }
}

const CHAT_MODE_LABELS: Record<ChatSession['aiMode'], string> = {
  deep_think: '深度思考',
  risk_assessment: '风险识别',
  intervention: '干预建议',
  scale_interpret: '量表解读',
};

const CHAT_MODE_OPTIONS: Array<{ key: ChatSession['aiMode']; label: string }> = [
  { key: 'deep_think', label: '深度思考' },
  { key: 'risk_assessment', label: '风险识别' },
  { key: 'intervention', label: '干预建议' },
  { key: 'scale_interpret', label: '量表解读' },
];

const RECOMMENDED_QUESTIONS_BY_MODE: Record<ChatSession['aiMode'], string[]> = {
  deep_think: [
    '如何缓解焦虑情绪？请先帮我判断我现在更像压力反应、焦虑还是抑郁倾向。',
    '如果一个人连续两周情绪低落、失眠、注意力下降，应该如何系统判断严重程度？',
    '抑郁和焦虑经常同时出现时，日常最先该处理的三个问题是什么？',
    '当我说不清自己为什么难受时，你可以用提问的方式一步步帮我梳理吗？',
  ],
  risk_assessment: [
    '请帮我识别这段表达里是否存在自伤或自杀风险信号，并说明判断依据。',
    '如果一个人说“活着没什么意思，但我不会真的去做”，风险等级通常怎么判断？',
    '评估危机风险时，最关键要核实的危险细节有哪些？',
    '请给我一套适合辅导员或家长使用的风险识别提问清单。',
  ],
  intervention: [
    '如果对方今晚情绪非常差，我现在最优先该做哪三步干预？',
    '请给我一份“接下来1小时、今晚、24小时内”的陪伴与干预清单。',
    '当对方拒绝沟通、又让我担心安全时，现实中应该怎样升级处置？',
    '如果需要联系家属、老师或医院，沟通时该怎么说更稳妥？',
  ],
  scale_interpret: [
    '量表分数出来后，应该怎样结合最近状态做解释，而不是只看高低？',
    'PHQ-9 或 GAD-7 分数偏高时，通常意味着什么，还需要结合哪些信息？',
    '请帮我把量表结果翻译成家长、老师也能听懂的说明。',
    '量表提示有风险时，后续适合补做哪些问题核查或支持动作？',
  ],
};

const CHAT_FEEDBACK_STORAGE_KEY = 'vis4srd-chat-feedback';

function toMindMapGroup(value: unknown, fallback: MindMapNode['group'] = 'core'): MindMapNode['group'] {
  return value === 'question' || value === 'core' || value === 'support' || value === 'action' ? value : fallback;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatChatInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-[#222]">$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="text-[#2E6AA1] underline">$1</span>');
  return s;
}

function renderChatMessageHtml(content: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const header = line.match(/^(#{1,6})\s+(.+)$/);
    if (header) {
      const level = header[1].length;
      const size = level === 1 ? 'text-[1.55em]' : level === 2 ? 'text-[1.35em]' : 'text-[1.2em]';
      blocks.push(`<h${level} class="${size} font-bold text-[#1F1F1F] mt-5 mb-3">${formatChatInline(header[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      blocks.push('<div class="my-5 border-t border-[#ECECEC]"></div>');
      i += 1;
      continue;
    }
    const ul = /^\s*[*-]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^\s*[*-]\s+(.+)$/.exec(lines[i]);
        if (!match) break;
        items.push(`<li class="leading-[1.75]">${formatChatInline(match[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ul class="list-disc pl-6 my-3 text-[1em] text-[#202020]">${items.join('')}</ul>`);
      continue;
    }
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^\s*\d+\.\s+(.+)$/.exec(lines[i]);
        if (!match) break;
        items.push(`<li class="leading-[1.75]">${formatChatInline(match[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ol class="list-decimal pl-6 my-3 text-[1em] text-[#202020]">${items.join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+(.+)$/.test(lines[i]) &&
      !/^\s*[-*_]{3,}\s*$/.test(lines[i]) &&
      !/^\s*[*-]\s+(.+)$/.test(lines[i]) &&
      !/^\s*\d+\.\s+(.+)$/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(`<p class="my-2 text-[1em] leading-[1.75] text-[#232323]">${paragraph.map((item) => formatChatInline(item)).join('<br/>')}</p>`);
  }
  return blocks.join('');
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseJsonSafely(value: unknown): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeKnowledgeDocTargetId(rawId: unknown, fallbackTitle?: unknown): string {
  const idText = String(rawId || '').trim();
  const titleText = String(fallbackTitle || '').trim();

  if (/^doc_\d+$/i.test(idText)) {
    return titleText || '';
  }

  return idText || titleText || '';
}

function normalizeReferences(raw: any): ReferenceItem[] {
  if (!Array.isArray(raw)) return [];
  return uniqueBy(
    raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: normalizeKnowledgeDocTargetId(item.id || item.docId, item.title),
        title: String(item.title || item.name || '未命名来源'),
        type: item.type ? String(item.type) : undefined,
      })),
    (item) => item.id || item.title,
  );
}

function extractKeywords(question: string, content: string): string[] {
  const source = `${question} ${content}`
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 2);
  return uniqueBy(source, (item) => item).slice(0, 8);
}

function canOpenEvidenceDoc(evidence: Pick<EvidenceItem, 'docId' | 'sourceType'>): boolean {
  return Boolean(evidence.docId && evidence.sourceType !== 'answer');
}

function groupEvidenceItems(items: EvidenceItem[] = []): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();

  items.forEach((item, index) => {
    const groupKey = item.docId || `${item.sourceType}::${item.title}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groups.set(groupKey, {
      id: `evidence-group-${index}`,
      title: item.title,
      sourceType: item.sourceType,
      docId: item.docId,
      items: [item],
    });
  });

  return Array.from(groups.values());
}

function buildMindMap(question: string, keywords: string[], evidenceList: EvidenceItem[]): MindMapPayload {
  const seeds = uniqueBy(
    [
      keywords[0] || '自杀意念强度',
      keywords[1] || '计划与工具可得性',
      keywords[2] || '情绪耗竭程度',
      keywords[3] || '支持网络可用性',
      keywords[4] || '保护性因素',
      keywords[5] || '干预升级路径',
    ],
    (item) => item,
  ).slice(0, 6);
  const nodes: MindMapNode[] = [
    {
      id: 'question',
      label: question.length > 16 ? `${question.slice(0, 16)}...` : question,
      group: 'question',
      description: '这是当前对话的风险研判中心点。系统会把问答证据、支持资源和干预动作都挂接到这个问题上。',
      relatedEvidenceIds: evidenceList.map((item) => item.id),
    },
    ...seeds.map((seed, index): MindMapNode => ({
      id: `node-${index}`,
      label: seed,
      group: toMindMapGroup(index < 3 ? 'core' : index < 5 ? 'support' : 'action'),
      description:
        index === 0
          ? '先判断是否出现明确轻生、结束生命、告别或放弃求生等表达，这是整轮研判的第一危险门槛。'
          : index === 1
            ? '继续核查是否提到时间、地点、方式、工具准备，区分“想法”与“可能进入行动”的距离。'
          : index === 2
              ? '把绝望、麻木、崩溃、失眠、强烈自责等情绪体验串起来，看它是短时波动还是持续恶化。'
              : index === 3
                ? '确认家属、室友、辅导员、班主任等是否真实在线，能否承担持续陪伴和限制独处。'
                : index === 4
                  ? '除了风险信号，也要识别求生意愿、责任牵挂、主动求助和可接受干预，这些会影响处置级别。'
                  : '把当前状态落到“继续观察、重点预警、立即看护、紧急转介”中的某一层，并给出执行动作。',
      relatedEvidenceIds: evidenceList[index] ? [evidenceList[index].id] : evidenceList[0] ? [evidenceList[0].id] : [],
    })),
  ];
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      source: 'question',
      target: node.id,
      label: index < 3 ? '危险核验' : index < 5 ? '支持校准' : '行动升级',
    })),
    summary: '围绕当前问答同步研判危险表达、行动准备、支持资源与干预升级路径，形成可执行的处置判断。',
    focusNodeId: 'question',
  };
}

function parseEvidencePayload(raw: any, fallback: EvidenceItem[]): EvidenceItem[] {
  const parsed = parseJsonSafely(raw);
  if (!Array.isArray(parsed)) return fallback;
  return parsed.map((item: any, index: number) => ({
    id: String(item.id || `evidence-${index}`),
    title: String(item.title || item.source || `证据 ${index + 1}`),
    sourceType: String(item.sourceType || item.type || 'doc'),
    snippet: String(item.snippet || item.content || item.quote || '暂无证据片段'),
    claim: String(item.claim || item.relation || '支持当前回答的关键结论。'),
    docId:
      String(item.sourceType || item.type || 'doc') !== 'answer'
        ? normalizeKnowledgeDocTargetId(item.docId, item.title || item.source)
        : undefined,
  }));
}

function parseMindMapPayload(raw: any, question: string, fallbackEvidence: EvidenceItem[]): MindMapPayload {
  const parsed = parseJsonSafely(raw);
  if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
    return {
      nodes: parsed.nodes.map((node: any, index: number) => ({
        id: String(node.id || `node-${index}`),
        label: String(node.label || node.name || `节点${index + 1}`),
        group: node.group === 'question' || node.group === 'core' || node.group === 'support' || node.group === 'action'
          ? node.group
          : index === 0
            ? 'question'
            : 'core',
        description: String(node.description || node.desc || '知识点说明'),
        relatedEvidenceIds: Array.isArray(node.relatedEvidenceIds) ? node.relatedEvidenceIds.map(String) : [],
      })),
      edges: parsed.edges.map((edge: any) => ({
        source: String(edge.source || edge.from),
        target: String(edge.target || edge.to),
        label: edge.label ? String(edge.label) : undefined,
      })),
      summary: String(parsed.summary || '风险研判结构摘要'),
      focusNodeId: parsed.focusNodeId ? String(parsed.focusNodeId) : undefined,
    };
  }
  return buildMindMap(question, extractKeywords(question, ''), fallbackEvidence);
}

function parseKnowledgePanelPayload(
  raw: any,
  question: string,
  fallbackEvidence: EvidenceItem[],
): KnowledgePanelPayload | null {
  const parsed = parseJsonSafely(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const tableRows = Array.isArray((parsed as any).tableRows)
    ? (parsed as any).tableRows.map((row: any, index: number) => ({
        topic: String(row?.topic || `主题${index + 1}`),
        knowledge: String(row?.knowledge || ''),
        description: String(row?.description || ''),
      }))
    : [];

  return {
    mindMap: parseMindMapPayload((parsed as any).mindMap, question, fallbackEvidence),
    tableRows,
    followUpQuestions: Array.isArray((parsed as any).followUpQuestions)
      ? (parsed as any).followUpQuestions.map((item: any) => String(item))
      : [],
  };
}

function createUserMessage(message: ChatMessage): MessageViewModel {
  return {
    id: message.id,
    role: 'user',
    content: message.content,
    references: [],
    createdAt: message.createdAt,
  };
}

function loadFeedbackMap(): Record<string, 'up' | 'down'> {
  try {
    const raw = window.localStorage.getItem(CHAT_FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveFeedbackMap(map: Record<string, 'up' | 'down'>) {
  try {
    window.localStorage.setItem(CHAT_FEEDBACK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function formatProcessingTimeLabel(durationMs: number): string {
  return `用时${Math.max(0, durationMs / 1000).toFixed(2)}秒`;
}

function createAiMessage(message: ChatMessage, question: string): MessageViewModel {
  const references = normalizeReferences(message.references ?? message.referencesJson ?? message.retrievalSources ?? message.retrieval_sources);
  const ragContext = parseJsonSafely(message.ragContext ?? message.rag_context);
  const evidenceList = parseEvidencePayload(ragContext?.knowledgePanel?.evidence ?? ragContext?.evidence ?? ragContext, []);
  const panel = parseKnowledgePanelPayload(ragContext?.knowledgePanel, question, evidenceList);
  const resolvedMode = message.aiMode && message.aiMode in CHAT_MODE_LABELS
    ? (message.aiMode as ChatSession['aiMode'])
    : 'deep_think';
  return {
    id: message.id,
    role: 'ai',
    content: message.content,
    references,
    evidenceList,
    contextSources: Array.isArray(ragContext?.contextSources) ? ragContext.contextSources.map(String) : [],
    knowledgePanel: panel || undefined,
    modeLabel: CHAT_MODE_LABELS[resolvedMode],
    durationLabel: message.processingTimeMs ? formatProcessingTimeLabel(message.processingTimeMs) : undefined,
    isGenerating: false,
    feedback: null,
    createdAt: message.createdAt,
  };
}

function formatTimestamp(dateString?: string): string {
  const date = dateString ? new Date(dateString) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function getSessionGroupLabel(dateString?: string): string {
  if (!dateString) return '更早';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '更早';

  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((today - target) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 7) return '7天内';
  if (diffDays <= 30) return '30天内';
  return '更早';
}

function buildSessionItem(session: ChatSession, chatMessages: ChatMessage[]): SessionListItem {
  const userMessages = chatMessages.filter((message) => message.role === 'user' && message.content.trim());
  const aiMessages = chatMessages.filter((message) => message.role === 'ai' && message.content.trim());
  const titleSource = session.title?.trim() || userMessages[0]?.content || aiMessages[0]?.content || `${CHAT_MODE_LABELS[session.aiMode]}对话`;
  const previewSource = userMessages[userMessages.length - 1]?.content || aiMessages[aiMessages.length - 1]?.content || '开始新的风险研判与支持建议。';
  const anchorTime = session.lastMessageAt || session.createdAt;
  return {
    id: Number(session.id),
    title: titleSource.length > 18 ? `${titleSource.slice(0, 18)}...` : titleSource,
    preview: previewSource.length > 26 ? `${previewSource.slice(0, 26)}...` : previewSource,
    groupLabel: getSessionGroupLabel(anchorTime),
    rawTitle: session.title || null,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt,
    messageCount: session.messageCount,
    aiMode: session.aiMode,
    isPinned: session.isPinned,
    status: session.status,
  };
}

function groupSessions(items: SessionListItem[]): Array<{ label: string; items: SessionListItem[] }> {
  const order = ['今天', '昨天', '7天内', '30天内', '更早'];
  const map = new Map<string, SessionListItem[]>();

  items.forEach((item) => {
    const bucket = map.get(item.groupLabel) || [];
    bucket.push(item);
    map.set(item.groupLabel, bucket);
  });

  return order
    .map((label) => ({
      label,
      items:
        (map.get(label) || []).sort(
          (a, b) =>
            new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
            new Date(a.lastMessageAt || a.createdAt || 0).getTime(),
        ),
    }))
    .filter((group) => group.items.length > 0);
}

function getMindMapNodeTheme(group: MindMapNode['group']) {
  if (group === 'question') {
    return {
      line: '#6D63D8',
      border: '#8C86EA',
      fill: '#6D63D8',
      ring: 'rgba(109, 99, 216, 0.20)',
      chip: 'bg-[#EEEAFE] text-[#4D43B3]',
      glow: '0 14px 26px rgba(109, 99, 216, 0.24)',
    };
  }
  if (group === 'action') {
    return {
      line: '#F0B54B',
      border: '#F3C76F',
      fill: '#F3B23B',
      ring: 'rgba(243, 178, 59, 0.18)',
      chip: 'bg-[#FFF3DA] text-[#9A6A18]',
      glow: '0 14px 24px rgba(240, 181, 75, 0.22)',
    };
  }
  if (group === 'support') {
    return {
      line: '#73C797',
      border: '#9AD8B5',
      fill: '#35C85A',
      ring: 'rgba(53, 200, 90, 0.18)',
      chip: 'bg-[#EAF8F0] text-[#2E7F57]',
      glow: '0 14px 24px rgba(115, 199, 151, 0.22)',
    };
  }
  return {
    line: '#F19AAC',
    border: '#F3B2BF',
    fill: '#ED7F9A',
    ring: 'rgba(241, 154, 172, 0.18)',
    chip: 'bg-[#FFEAF0] text-[#A65067]',
    glow: '0 14px 24px rgba(241, 154, 172, 0.24)',
  };
}

function getMindMapGroupLabel(group: MindMapNode['group']) {
  if (group === 'question') return '当前问题';
  if (group === 'support') return '支持要素';
  if (group === 'action') return '干预动作';
  return '风险判断';
}

interface GraphNodeDatum extends MindMapNode {
  color: string;
  size: number;
  x?: number;
  y?: number;
}

interface GraphLinkDatum extends MindMapEdge {
  color: string;
  semanticKey: 'risk' | 'support' | 'protect' | 'action' | 'default';
}

function getMindMapEdgeTheme(label?: string) {
  const text = (label || '').trim();
  if (text.includes('危险')) {
    return { color: '#E66A8B', semanticKey: 'risk' as const };
  }
  if (text.includes('支持')) {
    return { color: '#4FA97A', semanticKey: 'support' as const };
  }
  if (text.includes('保护')) {
    return { color: '#38B36B', semanticKey: 'protect' as const };
  }
  if (text.includes('行动') || text.includes('升级')) {
    return { color: '#F0B54B', semanticKey: 'action' as const };
  }
  return { color: '#8BA2BC', semanticKey: 'default' as const };
}

function buildMindMapGraphData(mindMap: MindMapPayload) {
  const nodes: GraphNodeDatum[] = mindMap.nodes.map((node) => {
    const theme = getMindMapNodeTheme(node.group);
    return {
      ...node,
      color: theme.fill,
      size: node.group === 'question' ? 11 : node.group === 'action' ? 8 : 7,
    };
  });
  const links: GraphLinkDatum[] = mindMap.edges.map((edge) => {
    const semantic = getMindMapEdgeTheme(edge.label);
    return {
      ...edge,
      color: semantic.color,
      semanticKey: semantic.semanticKey,
    };
  });
  return { nodes, links };
}

function getCompactMindMapPositions(nodes: MindMapNode[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  if (!nodes.length) return positions;
  positions[nodes[0].id] = { x: 50, y: 58 };
  const slots = [
    { x: 50, y: 24 },
    { x: 25, y: 40 },
    { x: 75, y: 40 },
    { x: 25, y: 74 },
    { x: 75, y: 74 },
    { x: 50, y: 88 },
  ];
  nodes.slice(1).forEach((node, index) => {
    positions[node.id] = slots[index] || { x: 50, y: 50 };
  });
  return positions;
}

function MindMapPreview({
  mindMap,
  selectedNodeId,
  onSelectNode,
  compact,
}: {
  mindMap: MindMapPayload;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const clickRef = useRef<{ id: string; at: number } | null>(null);
  const [graphSize, setGraphSize] = useState({
    width: compact ? 280 : 900,
    height: compact ? 230 : 620,
  });
  const [hoveredLink, setHoveredLink] = useState<GraphLinkDatum | null>(null);
  const graphData = useMemo(() => buildMindMapGraphData(mindMap), [mindMap]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setGraphSize({
        width: Math.max(220, Math.floor(entry.contentRect.width)),
        height: compact ? 230 : Math.max(460, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => {
    if (!graphRef.current) return;
    const chargeForce = graphRef.current.d3Force('charge');
    const linkForce = graphRef.current.d3Force('link');

    chargeForce?.strength(compact ? -90 : -340);
    linkForce?.distance((link: any) => {
      const target = link.target as GraphNodeDatum | string;
      const targetGroup = typeof target === 'object' ? target.group : mindMap.nodes.find((node) => node.id === target)?.group;
      if (compact) return targetGroup === 'question' ? 42 : 34;
      return targetGroup === 'question' ? 148 : targetGroup === 'action' ? 132 : 118;
    });
    linkForce?.strength(compact ? 0.72 : 0.38);
    graphRef.current.d3Force('collision', forceCollide((node: any) => compact ? (node.size || 6) + 8 : (node.size || 6) + 34));
    graphRef.current.d3ReheatSimulation();
  }, [compact, mindMap.nodes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!graphRef.current) return;
      try {
        graphRef.current.zoomToFit(700, compact ? 30 : 40);
      } catch {
        // ignore graph timing errors
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [compact, graphData]);

  const relatedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set<string>([selectedNodeId]);
    mindMap.edges.forEach((edge) => {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    });
    return ids;
  }, [mindMap.edges, selectedNodeId]);

  const hoveredLinkKey = hoveredLink ? `${hoveredLink.source}-${hoveredLink.target}-${hoveredLink.label || ''}` : null;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-[24px] border border-[#DCE7F5] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(239,246,255,0.96)_46%,rgba(231,240,251,0.92)_100%)] ${compact ? 'h-[230px]' : 'h-[620px]'}`}
    >
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: 'radial-gradient(#C7D6E6 1px, transparent 1px)',
          backgroundSize: compact ? '30px 30px' : '34px 34px',
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.14)_44%,rgba(101,137,207,0.06)_100%)]" />
      <div className="absolute inset-x-5 top-4 z-10 flex items-center justify-between text-[12px] text-[#91A2B5]">
        <span>知识图谱</span>
        <span>{compact ? `${mindMap.nodes.length} 个节点 / ${mindMap.edges.length} 条关系` : '力导向关系图'}</span>
      </div>
      <div className={`absolute inset-0 ${compact ? 'pt-8' : 'pt-10'}`}>
        {compact ? (
          <div className="relative h-full w-full">
            <svg className="absolute inset-0 h-full w-full">
              {mindMap.edges.map((edge, index) => {
                const positions = getCompactMindMapPositions(mindMap.nodes);
                const source = positions[edge.source];
                const target = positions[edge.target];
                const semantic = getMindMapEdgeTheme(edge.label);
                if (!source || !target) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${index}`}
                    x1={`${source.x}%`}
                    y1={`${source.y}%`}
                    x2={`${target.x}%`}
                    y2={`${target.y}%`}
                    stroke={semantic.color}
                    strokeOpacity="0.7"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
            {mindMap.nodes.map((node) => {
              const pos = getCompactMindMapPositions(mindMap.nodes)[node.id];
              const theme = getMindMapNodeTheme(node.group);
              const selected = node.id === selectedNodeId;
              if (!pos) return null;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  title={node.label}
                >
                  <span
                    className="block rounded-full border-4 border-white"
                    style={{
                      width: node.group === 'question' ? 28 : 18,
                      height: node.group === 'question' ? 28 : 18,
                      background: theme.fill,
                      boxShadow: selected ? `0 0 0 6px ${theme.ring}` : '0 8px 18px rgba(88,116,152,0.18)',
                    }}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={graphSize.width}
            height={graphSize.height}
            backgroundColor="rgba(0,0,0,0)"
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            cooldownTicks={120}
            d3AlphaDecay={0.045}
            d3VelocityDecay={0.25}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
            onNodeClick={(node) => {
              const item = node as GraphNodeDatum;
              const nodeId = String(item.id);
              const now = Date.now();
              const lastClick = clickRef.current;
              onSelectNode(nodeId);

              if (lastClick && lastClick.id === nodeId && now - lastClick.at < 320 && graphRef.current) {
                graphRef.current.centerAt(item.x || 0, item.y || 0, 500);
                graphRef.current.zoom(2.4, 500);
                clickRef.current = null;
                return;
              }

              clickRef.current = { id: nodeId, at: now };
            }}
            onNodeDragEnd={(node) => {
              const item = node as GraphNodeDatum & { fx?: number; fy?: number };
              item.fx = item.x;
              item.fy = item.y;
            }}
            onBackgroundClick={() => {
              if (graphRef.current) {
                graphRef.current.zoomToFit(500, 40);
              }
            }}
            onLinkHover={(link) => setHoveredLink((link as GraphLinkDatum | null) || null)}
            linkLabel={(link) => {
              const item = link as GraphLinkDatum;
              const sourceLabel = typeof item.source === 'object' ? (item.source as GraphNodeDatum).label : String(item.source);
              const targetLabel = typeof item.target === 'object' ? (item.target as GraphNodeDatum).label : String(item.target);
              return `<div style="padding:6px 8px;"><div style="font-weight:600;">${item.label || '关系'}</div><div style="margin-top:4px;">${sourceLabel} -> ${targetLabel}</div></div>`;
            }}
            linkWidth={(link) => {
              const item = link as GraphLinkDatum;
              const currentKey = `${item.source}-${item.target}-${item.label || ''}`;
              if (hoveredLinkKey && hoveredLinkKey === currentKey) return 3.4;
              if (selectedNodeId && (item.source === selectedNodeId || item.target === selectedNodeId)) return 2.6;
              return 1.5;
            }}
            linkColor={(link) => {
              const item = link as GraphLinkDatum;
              const currentKey = `${item.source}-${item.target}-${item.label || ''}`;
              if (hoveredLinkKey && hoveredLinkKey === currentKey) return item.color;
              if (selectedNodeId && (item.source === selectedNodeId || item.target === selectedNodeId)) return item.color;
              return `${item.color}66`;
            }}
            linkDirectionalParticles={(link) => {
              const item = link as GraphLinkDatum;
              const currentKey = `${item.source}-${item.target}-${item.label || ''}`;
              return hoveredLinkKey && hoveredLinkKey === currentKey ? 4 : 0;
            }}
            linkDirectionalParticleWidth={2.4}
            linkDirectionalParticleColor={(link) => (link as GraphLinkDatum).color}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const item = node as GraphNodeDatum;
              const theme = getMindMapNodeTheme(item.group);
              const selected = item.id === selectedNodeId;
              const related = relatedNodeIds.has(item.id);
              const label = item.label.length > 12 ? `${item.label.slice(0, 12)}...` : item.label;
              const fontSize = 12 / globalScale;
              const radius = (selected ? item.size + 3 : item.size) / globalScale;

              ctx.beginPath();
              ctx.arc(item.x || 0, item.y || 0, radius + (selected ? 3 / globalScale : 0), 0, 2 * Math.PI, false);
              ctx.fillStyle = selected ? theme.ring : 'rgba(255,255,255,0.78)';
              ctx.fill();

              ctx.beginPath();
              ctx.arc(item.x || 0, item.y || 0, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = item.color;
              ctx.shadowColor = selected ? theme.line : 'rgba(148, 163, 184, 0.28)';
              ctx.shadowBlur = selected ? 18 / globalScale : 10 / globalScale;
              ctx.fill();
              ctx.shadowBlur = 0;

              const shouldDrawLabel = selected || item.group === 'question' || related;
              if (!shouldDrawLabel) return;

              ctx.font = `${selected ? 700 : 500} ${fontSize}px sans-serif`;
              const textWidth = ctx.measureText(label).width;
              const paddingX = 8 / globalScale;
              const paddingY = 5 / globalScale;
              const boxWidth = textWidth + paddingX * 2;
              const boxHeight = fontSize + paddingY * 2;
              const boxX = (item.x || 0) - boxWidth / 2;
              const boxY = (item.y || 0) - radius - boxHeight - 8 / globalScale;

              ctx.fillStyle = selected ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.88)';
              ctx.strokeStyle = selected ? theme.border : 'rgba(203, 213, 225, 0.7)';
              ctx.lineWidth = 1 / globalScale;
              ctx.beginPath();
              ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 999);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = selected ? '#233245' : '#516273';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, item.x || 0, boxY + boxHeight / 2);
            }}
          />
        )}
      </div>
      {!compact && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 flex flex-wrap gap-2">
          {(['question', 'core', 'support', 'action'] as MindMapNode['group'][]).map((group) => {
            const theme = getMindMapNodeTheme(group);
            return (
              <span
                key={group}
                className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/76 px-3 py-1 text-[11px] text-[#5A6C80] backdrop-blur-sm"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.fill }} />
                {getMindMapGroupLabel(group)}
              </span>
            );
          })}
          <>
            {[
              { label: '危险核验', color: '#E66A8B' },
              { label: '支持校验', color: '#4FA97A' },
              { label: '保护性检验', color: '#38B36B' },
              { label: '行动升级', color: '#F0B54B' },
            ].map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/76 px-3 py-1 text-[11px] text-[#5A6C80] backdrop-blur-sm"
              >
                <span className="h-[2px] w-4 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </>
        </div>
      )}
    </div>
  );
}

function ReferenceBadge({ iconText }: { iconText: string }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3557D4] text-xs font-bold text-white">
      {iconText}
    </span>
  );
}

export default function ChatPage() {
  const navigate = useNavigate();
  const messageListRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const streamingUiRef = useRef<Map<number | string, StreamingUiState>>(new Map());
  const shouldAutoScrollRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const [sessionItems, setSessionItems] = useState<SessionListItem[]>([]);
  const [messages, setMessages] = useState<MessageViewModel[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentChatMode, setCurrentChatMode] = useState<ChatSession['aiMode']>('deep_think');
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionPanelCollapsed, setSessionPanelCollapsed] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [activeAnswerId, setActiveAnswerId] = useState<number | string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<number | string | null>(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<number | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');

  const chatLayoutRef = useRef<HTMLDivElement>(null);
  const layoutDragRef = useRef<{
    pointerId: number;
    edge: 'left' | 'right';
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);
  const layoutRatiosRef = useRef(readLayoutRatios());
  const leftAsidePxRef = useRef(CHAT_LAYOUT_LEFT_MIN);
  const rightAsidePxRef = useRef(CHAT_LAYOUT_RIGHT_MIN);
  const [leftAsidePx, setLeftAsidePx] = useState(CHAT_LAYOUT_LEFT_MIN);
  const [rightAsidePx, setRightAsidePx] = useState(CHAT_LAYOUT_RIGHT_MIN);
  const [isLayoutDragging, setIsLayoutDragging] = useState(false);

  const inputDockDragRef = useRef<{ pointerId: number; startY: number; startH: number } | null>(null);
  const [inputDockHeightPx, setInputDockHeightPx] = useState(readStoredInputDockHeight);
  const inputDockHeightRef = useRef(readStoredInputDockHeight());
  const [isInputDockDragging, setIsInputDockDragging] = useState(false);

  useEffect(() => {
    leftAsidePxRef.current = leftAsidePx;
  }, [leftAsidePx]);
  useEffect(() => {
    rightAsidePxRef.current = rightAsidePx;
  }, [rightAsidePx]);
  useEffect(() => {
    inputDockHeightRef.current = inputDockHeightPx;
  }, [inputDockHeightPx]);

  const applyChatLayoutFromRatios = useCallback(() => {
    const root = chatLayoutRef.current;
    if (!root || isLayoutDragging) return;
    const total = root.getBoundingClientRect().width;
    if (total < 480) return;
    if (sessionPanelCollapsed || !rightPanelVisible) return;
    const { left: lr, right: rr } = layoutRatiosRef.current;
    const { leftW, rightW } = resolveChatColumnWidths(total, lr, rr);
    leftAsidePxRef.current = leftW;
    rightAsidePxRef.current = rightW;
    setLeftAsidePx(leftW);
    setRightAsidePx(rightW);
  }, [isLayoutDragging, sessionPanelCollapsed, rightPanelVisible]);

  useLayoutEffect(() => {
    applyChatLayoutFromRatios();
  }, [applyChatLayoutFromRatios]);

  useEffect(() => {
    const root = chatLayoutRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      applyChatLayoutFromRatios();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [applyChatLayoutFromRatios]);

  const activeAnswer = useMemo(
    () => messages.find((item) => item.id === activeAnswerId && item.role === 'ai') || [...messages].reverse().find((item) => item.role === 'ai') || null,
    [activeAnswerId, messages],
  );

  const selectedNode = useMemo(() => {
    if (!activeAnswer?.knowledgePanel) return null;
    return activeAnswer.knowledgePanel.mindMap.nodes.find((node) => node.id === selectedNodeId) || activeAnswer.knowledgePanel.mindMap.nodes[0] || null;
  }, [activeAnswer, selectedNodeId]);

  const selectedEvidence = useMemo(() => {
    if (!activeAnswer?.evidenceList) return null;
    return activeAnswer.evidenceList.find((item) => item.id === selectedEvidenceId) || activeAnswer.evidenceList[0] || null;
  }, [activeAnswer, selectedEvidenceId]);

  const groupedActiveEvidence = useMemo(
    () => groupEvidenceItems(activeAnswer?.evidenceList || []),
    [activeAnswer?.evidenceList],
  );

  const selectedRelations = useMemo(() => {
    if (!activeAnswer?.knowledgePanel?.mindMap || !selectedNode) return [];
    const nodeMap = new Map(activeAnswer.knowledgePanel.mindMap.nodes.map((node) => [node.id, node]));
    return activeAnswer.knowledgePanel.mindMap.edges
      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map((edge) => {
        const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
        return {
          edgeLabel: edge.label || '关联',
          node: nodeMap.get(otherId),
        };
      })
      .filter((item) => item.node);
  }, [activeAnswer, selectedNode]);

  const sessionGroups = useMemo(() => groupSessions(sessionItems), [sessionItems]);
  const recommendedQuestions = useMemo(
    () => RECOMMENDED_QUESTIONS_BY_MODE[currentChatMode] || RECOMMENDED_QUESTIONS_BY_MODE.deep_think,
    [currentChatMode],
  );

  /** 左侧会话列表（非全局导航）：窄宽度时同步缩小根字号，子元素用 em 比例缩放以保留可读性 */
  const leftSessionPanelFontPx = useMemo(() => {
    if (sessionPanelCollapsed) return 13;
    const minW = CHAT_LAYOUT_LEFT_MIN;
    const refW = 292;
    const w = leftAsidePx;
    const t = Math.min(1, Math.max(0, (w - minW) / Math.max(1, refW - minW)));
    return Math.round((10.25 + t * 3.35) * 10) / 10;
  }, [leftAsidePx, sessionPanelCollapsed]);

  /** 右侧知识清单：窄宽度时同步缩小根字号，子元素用 em 比例缩放 */
  const rightKnowledgePanelFontPx = useMemo(() => {
    if (!rightPanelVisible) return 13;
    const minW = CHAT_LAYOUT_RIGHT_MIN;
    const refW = 300;
    const w = rightAsidePx;
    const t = Math.min(1, Math.max(0, (w - minW) / Math.max(1, refW - minW)));
    return Math.round((10.25 + t * 3.35) * 10) / 10;
  }, [rightAsidePx, rightPanelVisible]);

  const resetConversationView = () => {
    streamingUiRef.current.forEach((state) => {
      if (state.timerId) window.clearInterval(state.timerId);
      if (state.typingTimerId) window.clearInterval(state.typingTimerId);
    });
    streamingUiRef.current.clear();
    setMessages([]);
    setActiveAnswerId(null);
    setSelectedNodeId(null);
    setSelectedEvidenceId(null);
  };

  const loadSessionMessages = async (sessionId: number) => {
    const rawMessages = await fetchChatMessages(sessionId);
    const feedbackMap = loadFeedbackMap();
    const mapped: MessageViewModel[] = [];
    let lastQuestion = '';
    rawMessages.forEach((message) => {
      if (message.role === 'user') {
        lastQuestion = message.content;
        mapped.push(createUserMessage(message));
      } else if (message.role === 'ai') {
        const aiMessage = createAiMessage(message, lastQuestion || '当前问题');
        aiMessage.feedback = feedbackMap[String(aiMessage.id)] || null;
        mapped.push(aiMessage);
      }
    });
    setMessages(mapped);
    const latestAi = [...mapped].reverse().find((item) => item.role === 'ai') || null;
    setActiveAnswerId(latestAi?.id || null);
    setSelectedNodeId(latestAi?.knowledgePanel?.mindMap.nodes[0]?.id || null);
    setSelectedEvidenceId(latestAi?.evidenceList?.[0]?.id || null);
    return rawMessages;
  };

  const refreshSessions = async (
    preferredSessionId?: number | null,
    options?: { preferActive?: boolean },
  ) => {
    const sessionsRes = await fetchChatSessions({ limit: 20 });
    const sessions = sessionsRes.sessions || [];
    const visibleSessions = sessions.filter((session) => session.status === 'active');
    const previewEntries = await Promise.all(
      visibleSessions.map(async (session) => {
        try {
          const sessionMessages = await fetchChatMessages(Number(session.id));
          return buildSessionItem(session, sessionMessages);
        } catch {
          return buildSessionItem(session, []);
        }
      }),
    );
    setSessionItems(previewEntries);

    const activeSessions = visibleSessions;
    const nextSessionId =
      preferredSessionId != null && visibleSessions.some((session) => Number(session.id) === Number(preferredSessionId))
        ? Number(preferredSessionId)
        : options?.preferActive
          ? activeSessions.length > 0
            ? Number(activeSessions[0].id)
            : null
          : visibleSessions.length > 0
          ? Number(visibleSessions[0].id)
          : null;

    return { sessions: visibleSessions, nextSessionId };
  };

  const applySessionSelection = async (sessionId: number, sessions?: ChatSession[]) => {
    const normalizedSessionId = Number(sessionId);
    setCurrentSessionId(normalizedSessionId);
    const targetSession =
      sessions?.find((item) => Number(item.id) === normalizedSessionId) ||
      sessionItems.find((item) => Number(item.id) === normalizedSessionId);
    if (targetSession?.aiMode) {
      setCurrentChatMode(targetSession.aiMode);
    }
    await loadSessionMessages(normalizedSessionId);
  };

  const clearCurrentSessionView = () => {
    setCurrentSessionId(null);
    resetConversationView();
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        const { sessions, nextSessionId } = await refreshSessions(undefined, { preferActive: true });
        if (nextSessionId) {
          await applySessionSelection(nextSessionId, sessions);
        } else {
          const newSession = await createChatSession({ aiMode: currentChatMode, contextType: 'general' });
          const sessionId = Number(newSession.id);
          clearCurrentSessionView();
          setCurrentSessionId(sessionId);
          await refreshSessions(sessionId);
        }
      } catch (error) {
        console.error('加载聊天页失败:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= 120;
  }, [currentSessionId, messages.length]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const hasNewMessage = messages.length > previousCount;
    previousMessageCountRef.current = messages.length;

    if (!hasNewMessage || !shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: previousCount === 0 ? 'auto' : 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    return () => {
      streamingUiRef.current.forEach((state) => {
        if (state.timerId) window.clearInterval(state.timerId);
        if (state.typingTimerId) window.clearInterval(state.typingTimerId);
      });
      streamingUiRef.current.clear();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setOpenSessionMenuId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const updateAiMessage = (messageId: number | string, updater: (message: MessageViewModel) => MessageViewModel) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const clearStreamingUiState = (messageId: number | string) => {
    const state = streamingUiRef.current.get(messageId);
    if (!state) return;
    if (state.timerId) window.clearInterval(state.timerId);
    if (state.typingTimerId) window.clearInterval(state.typingTimerId);
    streamingUiRef.current.delete(messageId);
  };

  const finishStreamingUi = (
    messageId: number | string,
    options?: {
      forceContent?: string;
      durationLabel?: string;
      onBeforeFinish?: (message: MessageViewModel) => void;
    },
  ) => {
    const state = streamingUiRef.current.get(messageId);
    const finalDurationLabel =
      options?.durationLabel ||
      (state ? formatProcessingTimeLabel(performance.now() - state.startedAt) : '用时0.00秒');
    const finalContent = options?.forceContent ?? state?.fullContent ?? '';
    clearStreamingUiState(messageId);
    updateAiMessage(messageId, (message) => {
      (options?.onBeforeFinish ?? state?.onBeforeFinish)?.(message);
      return {
        ...message,
        content: finalContent,
        durationLabel: finalDurationLabel,
        isGenerating: false,
      };
    });
  };

  const startStreamingUi = (messageId: number | string) => {
    clearStreamingUiState(messageId);
    const state: StreamingUiState = {
      startedAt: performance.now(),
      displayedContent: '',
      fullContent: '',
      queuedChars: [],
      streamDone: false,
      timerId: null,
      typingTimerId: null,
      onBeforeFinish: undefined,
    };

    state.timerId = window.setInterval(() => {
      updateAiMessage(messageId, (message) => ({
        ...message,
        durationLabel: formatProcessingTimeLabel(performance.now() - state.startedAt),
      }));
    }, 100);

    state.typingTimerId = window.setInterval(() => {
      if (state.queuedChars.length > 0) {
        state.displayedContent += state.queuedChars.shift() || '';
        updateAiMessage(messageId, (message) => ({
          ...message,
          content: state.displayedContent,
          durationLabel: formatProcessingTimeLabel(performance.now() - state.startedAt),
          isGenerating: true,
        }));
        return;
      }

      if (state.streamDone) {
        finishStreamingUi(messageId);
      }
    }, 20);

    streamingUiRef.current.set(messageId, state);
  };

  const appendStreamingChunk = (messageId: number | string, chunk: string) => {
    const state = streamingUiRef.current.get(messageId);
    if (!state || !chunk) return;
    state.fullContent += chunk;
    state.queuedChars.push(...Array.from(chunk));
  };

  const markStreamingDone = (
    messageId: number | string,
    onBeforeFinish?: (message: MessageViewModel) => void,
  ) => {
    const state = streamingUiRef.current.get(messageId);
    if (!state) {
      finishStreamingUi(messageId, { onBeforeFinish });
      return;
    }
    state.onBeforeFinish = onBeforeFinish;
    state.streamDone = true;
    if (state.queuedChars.length === 0) {
      finishStreamingUi(messageId, { onBeforeFinish });
    }
  };

  const getQuestionForAiMessage = (messageId: number | string) => {
    const currentIndex = messages.findIndex((item) => item.id === messageId);
    if (currentIndex <= 0) return '';
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (item.role === 'user') {
        return item.content;
      }
    }
    return '';
  };

  const handleSwitchSession = async (sessionId: number) => {
    if (sessionId === currentSessionId) return;
    setIsLoading(true);
    try {
      await applySessionSelection(sessionId);
    } catch (error) {
      console.error('切换会话失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewSession = async () => {
    setIsLoading(true);
    try {
      const newSession = await createChatSession({ aiMode: currentChatMode, contextType: 'general' });
      const sessionId = Number(newSession.id);
      clearCurrentSessionView();
      setCurrentSessionId(sessionId);
      setInputText('');
      await refreshSessions(sessionId);
    } catch (error) {
      console.error('创建会话失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectChatMode = async (mode: ChatSession['aiMode']) => {
    setCurrentChatMode(mode);
    if (!currentSessionId) return;
    const currentSession = sessionItems.find((item) => item.id === currentSessionId);
    if (currentSession?.aiMode === mode) return;
    try {
      await updateChatSession(currentSessionId, { aiMode: mode });
      await refreshSessions(currentSessionId);
    } catch (error) {
      console.error('切换问答模式失败:', error);
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    const targetSession = sessionItems.find((item) => item.id === sessionId);
    const isCurrentSession = currentSessionId === sessionId;
    const confirmed = window.confirm(`确定删除会话“${targetSession?.title || `#${sessionId}`}”吗？删除后将不再显示在会话列表中。`);
    if (!confirmed) return;

    setOpenSessionMenuId(null);
    setIsLoading(true);
    try {
      if (isCurrentSession) {
        clearCurrentSessionView();
      }
      await deleteChatSession(sessionId);
      const fallbackCurrent = isCurrentSession ? null : currentSessionId;
      const { sessions, nextSessionId } = await refreshSessions(fallbackCurrent, { preferActive: true });
      if (isCurrentSession) {
        if (nextSessionId) {
          await applySessionSelection(nextSessionId, sessions);
        }
      }
    } catch (error) {
      console.error('删除会话失败:', error);
      window.alert(error instanceof Error ? error.message : '删除会话失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenameSession = async () => {
    const title = editingSessionTitle.trim();
    if (!editingSessionId) return;
    try {
      await updateChatSession(editingSessionId, { title: title || null });
      await refreshSessions(currentSessionId);
      setEditingSessionId(null);
      setEditingSessionTitle('');
    } catch (error) {
      console.error('重命名会话失败:', error);
    }
  };

  const handleTogglePinSession = async (session: SessionListItem) => {
    try {
      await updateChatSession(session.id, { isPinned: !session.isPinned });
      await refreshSessions(currentSessionId);
      setOpenSessionMenuId(null);
    } catch (error) {
      console.error('置顶会话失败:', error);
    }
  };

  const handleSendMessage = async (overrideText?: string, overrideMode?: ChatSession['aiMode']) => {
    const question = (overrideText ?? inputText).trim();
    if (!question || !currentSessionId) return;
    const activeMode = overrideMode || currentChatMode;

    const userMessage: MessageViewModel = {
      id: Date.now(),
      role: 'user',
      content: question,
      references: [],
      createdAt: new Date().toISOString(),
    };

    const placeholderId = Date.now() + 1;
    const aiMessage: MessageViewModel = {
      id: placeholderId,
      role: 'ai',
      content: '',
      references: [],
      evidenceList: [],
      contextSources: [],
      modeLabel: CHAT_MODE_LABELS[activeMode],
      durationLabel: '用时0.00秒',
      isGenerating: true,
      feedback: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setInputText('');
    setActiveAnswerId(placeholderId);
    setSelectedNodeId(null);
    setSelectedEvidenceId(null);
    startStreamingUi(placeholderId);

    try {
      await sendChatMessageStream(
        currentSessionId,
        question,
        activeMode,
        (chunk) => {
          appendStreamingChunk(placeholderId, chunk);
        },
        () => {
          markStreamingDone(placeholderId, (message) => {
            setSelectedEvidenceId(message.evidenceList?.[0]?.id || null);
            setSelectedNodeId(message.knowledgePanel?.mindMap.nodes[0]?.id || null);
          });
        },
        (error) => {
          finishStreamingUi(placeholderId, {
            forceContent: `抱歉，消息发送失败：${error.message}`,
            durationLabel: '生成失败',
          });
        },
        (sources) => {
          const refs = normalizeReferences(sources);
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            references: refs,
          }));
        },
        (mindMap) => {
          updateAiMessage(placeholderId, (message) => {
            if (!message.knowledgePanel) return message;
            return {
              ...message,
              knowledgePanel: {
                ...message.knowledgePanel,
                mindMap: parseMindMapPayload(mindMap, question, message.evidenceList || []),
              },
            };
          });
        },
        (evidence) => {
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            evidenceList: parseEvidencePayload(evidence, message.evidenceList || []),
          }));
        },
        (terms) => {
          void terms;
        },
        (sources) => {
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            contextSources: Array.isArray(sources) ? sources : [],
          }));
        },
        (panel) => {
          updateAiMessage(placeholderId, (message) => {
            const parsedPanel = parseKnowledgePanelPayload(panel, question, message.evidenceList || []);
            if (!parsedPanel) return message;
            setSelectedEvidenceId(message.evidenceList?.[0]?.id || null);
            setSelectedNodeId(parsedPanel.mindMap.nodes[0]?.id || null);
            return {
              ...message,
              knowledgePanel: parsedPanel,
            };
          });
        },
      );
      await refreshSessions(currentSessionId);
    } catch (error) {
      console.error('发送消息失败:', error);
      finishStreamingUi(placeholderId, {
        forceContent: error instanceof Error ? `抱歉，消息发送失败：${error.message}` : '抱歉，消息发送失败，请稍后重试。',
        durationLabel: '生成失败',
      });
    }
  };

  const handleCopyAnswer = async (message?: MessageViewModel | null) => {
    const targetMessage = message || activeAnswer;
    if (!targetMessage) return;
    try {
      await navigator.clipboard.writeText(targetMessage.content);
      setCopied(true);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const handleReadAloud = (message: MessageViewModel) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !message.content.trim()) return;
    const synth = window.speechSynthesis;

    if (speakingMessageId === message.id) {
      synth.cancel();
      speechUtteranceRef.current = null;
      setSpeakingMessageId(null);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content.replace(/\s+/g, ' ').trim());
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onerror = () => {
      speechUtteranceRef.current = null;
      setSpeakingMessageId(null);
    };
    speechUtteranceRef.current = utterance;
    synth.speak(utterance);
    setSpeakingMessageId(message.id);
  };

  const handleRegenerateMessage = async (messageId: number | string) => {
    const question = getQuestionForAiMessage(messageId);
    if (!question) return;
    await handleSendMessage(question);
  };

  const handleEditMessageQuestion = (messageId: number | string) => {
    const question = getQuestionForAiMessage(messageId);
    if (!question) return;
    setInputText(question);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = question.length;
      inputRef.current?.setSelectionRange(length, length);
    });
  };

  const handleFeedback = (messageId: number | string, type: 'up' | 'down') => {
    updateAiMessage(messageId, (message) => {
      const nextFeedback = message.feedback === type ? null : type;
      const feedbackMap = loadFeedbackMap();
      if (nextFeedback) {
        feedbackMap[String(message.id)] = nextFeedback;
      } else {
        delete feedbackMap[String(message.id)];
      }
      saveFeedbackMap(feedbackMap);
      return {
        ...message,
        feedback: nextFeedback,
      };
    });
  };

  const handleOpenDocPreview = (docId?: string, snippet?: string) => {
    if (!docId) return;
    const params = new URLSearchParams({ id: docId });
    if (snippet?.trim()) {
      params.set('snippet', snippet.trim());
    }
    navigate(`/doc-preview?${params.toString()}`);
  };

  const handleKnowledgeQuestion = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const resetChatLayoutWidths = () => {
    layoutRatiosRef.current = { left: CHAT_LAYOUT_LEFT_RATIO, right: CHAT_LAYOUT_RIGHT_RATIO };
    try {
      localStorage.removeItem(CHAT_LAYOUT_LEFT_PCT_LS);
      localStorage.removeItem(CHAT_LAYOUT_RIGHT_PCT_LS);
      localStorage.removeItem(CHAT_LAYOUT_LEFT_LS);
      localStorage.removeItem(CHAT_LAYOUT_RIGHT_LS);
    } catch {
      /* ignore */
    }
    queueMicrotask(() => {
      applyChatLayoutFromRatios();
    });
  };

  const resetInputDockHeight = () => {
    setInputDockHeightPx(CHAT_INPUT_DOCK_DEFAULT);
    inputDockHeightRef.current = CHAT_INPUT_DOCK_DEFAULT;
    try {
      localStorage.removeItem(CHAT_INPUT_DOCK_HEIGHT_LS);
    } catch {
      /* ignore */
    }
  };

  const attachInputDockResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    inputDockDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startH: inputDockHeightRef.current,
    };
    setIsInputDockDragging(true);
    const onMove = (ev: PointerEvent) => {
      const d = inputDockDragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const next = d.startH - (ev.clientY - d.startY);
      const v = Math.round(Math.min(CHAT_INPUT_DOCK_MAX, Math.max(CHAT_INPUT_DOCK_MIN, next)));
      inputDockHeightRef.current = v;
      setInputDockHeightPx(v);
    };
    const onUp = (ev: PointerEvent) => {
      const d = inputDockDragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      inputDockDragRef.current = null;
      setIsInputDockDragging(false);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        localStorage.setItem(CHAT_INPUT_DOCK_HEIGHT_LS, String(inputDockHeightRef.current));
      } catch {
        /* ignore */
      }
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const attachChatLayoutResize = (edge: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    if (edge === 'left' && sessionPanelCollapsed) return;
    if (edge === 'right' && !rightPanelVisible) return;
    event.preventDefault();
    event.stopPropagation();
    const handleEl = event.currentTarget;
    handleEl.setPointerCapture(event.pointerId);
    layoutDragRef.current = {
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startLeft: leftAsidePxRef.current,
      startRight: rightAsidePxRef.current,
    };
    setIsLayoutDragging(true);

    const onMove = (ev: PointerEvent) => {
      const d = layoutDragRef.current;
      const root = chatLayoutRef.current;
      if (!d || !root || ev.pointerId !== d.pointerId) return;
      const total = root.getBoundingClientRect().width;
      if (d.edge === 'left') {
        const next = d.startLeft + (ev.clientX - d.startX);
        const maxL = total - d.startRight - CHAT_LAYOUT_MIN_CENTER - CHAT_LAYOUT_CHROME;
        const v = Math.round(Math.min(CHAT_LAYOUT_MAX_COL, Math.max(CHAT_LAYOUT_LEFT_MIN, Math.min(next, maxL))));
        leftAsidePxRef.current = v;
        setLeftAsidePx(v);
      } else {
        const next = d.startRight + (d.startX - ev.clientX);
        const maxR = total - d.startLeft - CHAT_LAYOUT_MIN_CENTER - CHAT_LAYOUT_CHROME;
        const v = Math.round(Math.min(CHAT_LAYOUT_MAX_COL, Math.max(CHAT_LAYOUT_RIGHT_MIN, Math.min(next, maxR))));
        rightAsidePxRef.current = v;
        setRightAsidePx(v);
      }
    };

    const onUp = (ev: PointerEvent) => {
      const d = layoutDragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      layoutDragRef.current = null;
      setIsLayoutDragging(false);
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        const root = chatLayoutRef.current;
        const total = root?.getBoundingClientRect().width ?? 0;
        if (total > 100) {
          const lp = leftAsidePxRef.current / total;
          const rp = rightAsidePxRef.current / total;
          layoutRatiosRef.current = { left: lp, right: rp };
          localStorage.setItem(CHAT_LAYOUT_LEFT_PCT_LS, String(lp));
          localStorage.setItem(CHAT_LAYOUT_RIGHT_PCT_LS, String(rp));
        }
        localStorage.removeItem(CHAT_LAYOUT_LEFT_LS);
        localStorage.removeItem(CHAT_LAYOUT_RIGHT_LS);
      } catch {
        /* ignore */
      }
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const centerTimestamp = useMemo(() => formatTimestamp(activeAnswer?.createdAt), [activeAnswer?.createdAt]);

  return (
    <div
      ref={chatLayoutRef}
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch lg:gap-3 xl:gap-4 2xl:gap-5"
    >
      <aside
        style={{
          width: sessionPanelCollapsed ? undefined : leftAsidePx,
        }}
        className={`hidden h-full min-h-0 shrink-0 overflow-hidden rounded-[30px] border border-[#E5ECF5] bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(247,250,254,0.98)_100%)] shadow-[0_18px_42px_rgba(78,101,132,0.08)] lg:flex lg:flex-col ${
          sessionPanelCollapsed ? 'lg:w-[88px]' : ''
        } ${!isLayoutDragging && !sessionPanelCollapsed ? 'lg:transition-[width] lg:duration-200' : ''}`}
      >
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden"
          style={{ fontSize: `${leftSessionPanelFontPx}px` }}
        >
        <div className="border-b border-[#EBF0F6] px-[1.05em] py-[1.05em]">
          <div className={`flex items-center ${sessionPanelCollapsed ? 'justify-center' : 'justify-between'} gap-[0.75em]`}>
            {!sessionPanelCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="break-words text-[1.62em] font-semibold leading-tight text-[#2B5FD9]">VIS4SRD Chat</div>
                <div className="mt-[0.35em] break-words text-[1em] leading-snug text-[#8A97AA]">风险研判与知识推理会话</div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSessionPanelCollapsed((prev) => !prev)}
              className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-full p-[0.35em] text-[#60738B] transition hover:bg-white hover:text-[#3557D4]"
              title={sessionPanelCollapsed ? '展开会话侧栏' : '收起会话侧栏'}
            >
              {sessionPanelCollapsed ? (
                <PanelLeftOpen className="h-[1.05em] w-[1.05em]" />
              ) : (
                <PanelLeftClose className="h-[1.05em] w-[1.05em]" />
              )}
            </button>
          </div>

          <button
            onClick={handleCreateNewSession}
            className={`mt-[1em] flex items-center rounded-[1.15em] border border-[#DCE7F4] bg-white text-[#1F2E43] shadow-[0_12px_28px_rgba(86,111,146,0.08)] transition hover:-translate-y-[1px] hover:border-[#C7D9EE] hover:shadow-[0_14px_32px_rgba(86,111,146,0.12)] ${
              sessionPanelCollapsed ? 'mx-auto h-[2.85em] min-h-[44px] w-[2.85em] min-w-[44px] justify-center' : 'w-full gap-[0.75em] px-[1em] py-[0.85em]'
            }`}
            title="开启新对话"
          >
            <Plus className="h-[1.05em] w-[1.05em] shrink-0" />
            {!sessionPanelCollapsed && <span className="break-words text-left text-[1.15em] font-medium">开启新对话</span>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[0.75em] py-[1em]">
          {sessionPanelCollapsed ? (
            <div className="space-y-[0.75em]">
              {sessionItems.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSwitchSession(session.id)}
                  className={`flex h-[2.85em] min-h-[40px] w-[2.85em] min-w-[40px] items-center justify-center rounded-[1.15em] border text-[1em] font-semibold transition ${
                    currentSessionId === session.id
                      ? 'border-[#C9DAF5] bg-[#EEF4FF] text-[#2457C5] shadow-[0_10px_24px_rgba(36,87,197,0.12)]'
                      : 'border-transparent bg-white text-[#76879B] hover:border-[#E3EAF3] hover:text-[#3557D4]'
                  }`}
                  title={session.title}
                >
                  {session.title.slice(0, 2)}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-[1.35em]">
              {sessionGroups.map((group) => (
                <section key={group.label}>
                  <div className="mb-[0.65em] px-[0.35em] text-[1em] font-medium text-[#8C99AA]">{group.label}</div>
                  <div className="space-y-[0.4em]">
                    {group.items.map((session) => {
                      const active = currentSessionId === session.id;
                      return (
                        <div
                          key={session.id}
                          className={`group flex w-full items-start gap-[0.65em] rounded-[1.1em] px-[0.65em] py-[0.65em] text-left transition ${
                            active
                              ? 'bg-[#EEF4FF] text-[#1E3E75] shadow-[0_12px_24px_rgba(58,103,189,0.10)]'
                              : 'text-[#46576B] hover:bg-white'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSwitchSession(session.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleSwitchSession(session.id);
                              }
                            }}
                            className="flex min-w-0 flex-1 items-start gap-[0.65em] text-left"
                          >
                            <div className={`mt-[0.15em] flex h-[2.35em] min-h-[32px] w-[2.35em] min-w-[32px] shrink-0 items-center justify-center rounded-[0.85em] ${
                              active ? 'bg-white text-[#2559D4]' : 'bg-[#F4F7FB] text-[#7A8CA3] group-hover:bg-[#EDF3FB]'
                            }`}>
                              <PenSquare className="h-[1.05em] w-[1.05em]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-[1.08em] font-medium leading-snug">{session.title}</div>
                              <div className="mt-[0.35em] break-words text-[0.95em] leading-snug text-[#8A97AA]">{session.preview}</div>
                              <div className="mt-[0.5em] flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.25em] text-[0.88em] text-[#9AA7B8]">
                                <span>{CHAT_MODE_LABELS[session.aiMode]}</span>
                                <span className="h-[0.35em] w-[0.35em] shrink-0 rounded-full bg-[#CBD5E1]" />
                                <span>{session.messageCount}条消息</span>
                                {session.isPinned && (
                                  <>
                                    <span className="h-[0.35em] w-[0.35em] shrink-0 rounded-full bg-[#CBD5E1]" />
                                    <span>已置顶</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="relative mt-[0.15em] shrink-0">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenSessionMenuId((prev) => (prev === session.id ? null : session.id));
                              }}
                              className={`inline-flex h-[2em] min-h-[32px] w-[2em] min-w-[32px] items-center justify-center rounded-full transition ${
                                active ? 'text-[#6B7E98] hover:bg-white' : 'text-[#9AA7B8] hover:bg-[#F4F7FB] hover:text-[#60738B]'
                              }`}
                              title="更多操作"
                            >
                              <MoreHorizontal className="h-[1.05em] w-[1.05em]" />
                            </button>
                            {openSessionMenuId === session.id && (
                              <div
                                className="absolute right-0 top-[2.25em] z-20 w-[12.5em] overflow-hidden rounded-[1.1em] border border-[#E4EAF2] bg-white p-[0.35em] shadow-[0_18px_36px_rgba(85,104,129,0.14)]"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingSessionId(session.id);
                                    setEditingSessionTitle(session.rawTitle || session.title);
                                    setOpenSessionMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-[0.5em] rounded-[0.85em] px-[0.65em] py-[0.65em] text-left text-[1.05em] text-[#314255] transition hover:bg-[#F5F8FC]"
                                >
                                  <PencilLine className="h-[1em] w-[1em] shrink-0" />
                                  重命名
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleTogglePinSession(session);
                                  }}
                                  className="flex w-full items-center gap-[0.5em] rounded-[0.85em] px-[0.65em] py-[0.65em] text-left text-[1.05em] text-[#314255] transition hover:bg-[#F5F8FC]"
                                >
                                  <Pin className="h-[1em] w-[1em] shrink-0" />
                                  {session.isPinned ? '取消置顶' : '置顶会话'}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteSession(session.id);
                                  }}
                                  className="flex w-full items-center gap-[0.5em] rounded-[0.85em] px-[0.65em] py-[0.65em] text-left text-[1.05em] text-[#9A4D4D] transition hover:bg-[#FFF5F5]"
                                >
                                  <X className="h-[1em] w-[1em] shrink-0" />
                                  删除会话
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        </div>
      </aside>

      {!sessionPanelCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调节会话列表宽度，双击恢复默认"
          title="拖拽调节宽度；双击恢复默认"
          onPointerDown={(e) => attachChatLayoutResize('left', e)}
          onDoubleClick={(e) => {
            e.preventDefault();
            resetChatLayoutWidths();
          }}
          className="relative hidden shrink-0 touch-none select-none lg:flex lg:w-2 lg:items-stretch lg:justify-center"
        >
          <div className="my-6 flex w-full cursor-col-resize items-center justify-center rounded-full border border-transparent py-10 text-[#9AA7B8] transition hover:border-[#D0D9E8] hover:bg-[#EEF2F8] hover:text-[#5A6B80]">
            <GripVertical className="h-5 w-5 shrink-0" aria-hidden />
          </div>
        </div>
      )}

      <div className="chat-fluid-center flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={messageListRef}
          onScroll={() => {
            const container = messageListRef.current;
            if (!container) return;
            const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            shouldAutoScrollRef.current = distanceToBottom <= 120;
          }}
          className="w-full max-w-full flex-1 min-h-0 min-w-0 overflow-y-auto px-3 pb-6 pt-3 sm:px-4 md:px-5 lg:px-5 xl:px-6"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-[#E7EDF5] bg-[rgba(255,255,255,0.8)] px-5 py-4 shadow-[0_10px_30px_rgba(90,109,135,0.05)] backdrop-blur-sm">
            <div>
              <div className="text-[1.28em] font-semibold text-[#1C2A3A]">
                {sessionItems.find((item) => item.id === currentSessionId)?.title || '新对话'}
              </div>
              <div className="mt-1 text-[0.94em] text-[#8C99AA]">
                {sessionItems.find((item) => item.id === currentSessionId)?.preview || '围绕自杀风险识别、干预建议、量表解读展开连续问答。'}
              </div>
            </div>
            <div className="flex items-center gap-2 text-[0.94em] text-[#708399]">
              <span className="rounded-full bg-[#EEF4FF] px-3 py-1 text-[#2457C5]">
                {currentSessionId ? `会话 #${currentSessionId}` : '未选择会话'}
              </span>
              {copied && <span className="rounded-full bg-[#EEF8F1] px-3 py-1 text-[#2E7D4F]">已复制回答</span>}
            </div>
          </div>

          <div className="mb-6 flex justify-center text-[1em] text-[#8C8C8C]">{centerTimestamp}</div>

          {messages.length === 0 && !isLoading && (
            <div className="mt-12 rounded-[28px] border border-[#EEEEEE] bg-white px-8 py-10 shadow-[0_12px_36px_rgba(0,0,0,0.04)]">
              <div className="text-center text-[1.12em] text-[#666]">请输入你的问题跟我聊聊～</div>
              <div className="mt-6 flex w-full flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-1 [-webkit-overflow-scrolling:touch]">
                {recommendedQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => handleSendMessage(question, currentChatMode)}
                    className="inline-flex w-fit max-w-[min(38rem,93vw)] shrink-0 rounded-2xl border border-[#D9E5F4] bg-[#F8FBFF] px-3.5 py-2 text-left text-[1em] leading-snug text-[#37506A] transition hover:border-[#BFD4F4] hover:bg-white"
                  >
                    <span className="line-clamp-2 block max-w-full">{question}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-5">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="rounded-[16px] bg-[#F2F3F5] px-5 py-3 text-[1.08em] text-[#4A4A4A]">
                      {message.content}
                    </div>
                  </div>
                );
              }

              const active = activeAnswer?.id === message.id;
              return (
                <div
                  key={message.id}
                  className={`rounded-[28px] border bg-white p-6 shadow-[0_10px_28px_rgba(0,0,0,0.03)] transition ${active ? 'border-[#E7E7E7]' : 'border-transparent'}`}
                  onClick={() => {
                    setActiveAnswerId(message.id);
                    setSelectedNodeId(message.knowledgePanel?.mindMap.nodes[0]?.id || null);
                    setSelectedEvidenceId(message.evidenceList?.[0]?.id || null);
                  }}
                >
                  <div className="mb-4 flex items-center gap-3 text-[1em] text-[#212121]">
                    <div className="flex items-center gap-2 font-semibold">
                      <Bot className="h-5 w-5 text-[#303030]" />
                      {message.modeLabel || '深度思考'}
                    </div>
                    <div className="text-[#8A8A8A]">({message.durationLabel || '用时生成中'})</div>
                  </div>

                  {message.isGenerating && !message.content ? (
                    <div className="py-8 text-[1em] text-[#8C8C8C]">正在组织回答...</div>
                  ) : (
                    <div
                      className="chat-md text-[1em] text-[#232323] [&_a]:text-[#2F6CA5] [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: renderChatMessageHtml(message.content) }}
                    />
                  )}

                  {message.references.length > 0 && (
                    <div className="mt-6">
                      <div className="inline-flex items-center gap-3 rounded-full border border-[#E9E9E9] bg-white px-4 py-2 text-[1em] text-[#343434] shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="rounded-full border border-[#2D2D2D] p-1">
                            <FileText className="h-3.5 w-3.5" />
                          </div>
                          参考资料
                        </div>
                        <span className="rounded-full bg-[#2559D4] px-2 py-0.5 text-xs text-white">{message.references.length}</span>
                        <ReferenceBadge iconText="百" />
                        <ReferenceBadge iconText="馆" />
                      </div>
                    </div>
                  )}

                  {(message.references.length > 0 || active) && (
                    <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[#EFEFEF] pt-5 text-[#202020]">
                      <button
                        className="inline-flex items-center gap-2 text-[1em] font-medium"
                        title="打开右侧证据工作台"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRightPanelVisible(true);
                        }}
                      >
                        <GitBranch className="h-4 w-4" />
                        证据工作台
                      </button>
                      <button
                        className={`inline-flex items-center gap-2 text-[1em] ${speakingMessageId === message.id ? 'text-[#2457C5]' : ''}`}
                        title={speakingMessageId === message.id ? '停止朗读' : '朗读当前回答'}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleReadAloud(message);
                        }}
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                      <button
                        className={`inline-flex items-center gap-2 text-[1em] ${copied && active ? 'text-[#2457C5]' : ''}`}
                        title={copied && active ? '已复制' : '复制当前回答'}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCopyAnswer(message);
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        className="inline-flex items-center gap-2 text-[1em]"
                        title="重新生成这一轮回答"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRegenerateMessage(message.id);
                        }}
                      >
                        <RefreshCcw className="h-4 w-4" />
                      </button>
                      <button
                        className="inline-flex items-center gap-2 text-[1em]"
                        title="把这轮问题放回输入框继续编辑"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditMessageQuestion(message.id);
                        }}
                      >
                        <PencilLine className="h-4 w-4" />
                      </button>
                      <span className="h-5 w-px bg-[#E5E5E5]" />
                      <button
                        className={`inline-flex items-center gap-2 text-[1em] ${message.feedback === 'up' ? 'text-[#2E7D4F]' : ''}`}
                        title="这条回答有帮助"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFeedback(message.id, 'up');
                        }}
                      >
                        <ThumbsUp className="h-4 w-4" />
                      </button>
                      <button
                        className={`inline-flex items-center gap-2 text-[1em] ${message.feedback === 'down' ? 'text-[#9A4D4D]' : ''}`}
                        title="这条回答不够好"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFeedback(message.id, 'down');
                        }}
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {active && message.contextSources && message.contextSources.length > 0 && (
                    <div className="mt-4 rounded-[18px] border border-[#E8EEF6] bg-[#F8FBFF] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[1em] font-semibold text-[#24374B]">
                        <Archive className="h-4 w-4 text-[#67819B]" />
                        本轮检索线索
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {message.contextSources.slice(0, 6).map((item) => (
                          <span key={item} className="rounded-full border border-[#D9E5F2] bg-white px-3 py-1 text-[0.94em] text-[#51677D]">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {active && message.evidenceList && message.evidenceList.length > 0 && (
                    <div className="mt-4 rounded-[20px] border border-[#E6EDF5] bg-[#FBFCFE] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[1.05em] font-semibold text-[#203245]">
                        <Pin className="h-4 w-4 text-[#6D8197]" />
                        证据片段
                      </div>
                      <div className="space-y-3">
                        {groupEvidenceItems(message.evidenceList)
                          .slice(0, 2)
                          .map((group) => (
                            <div key={group.id} className="rounded-[16px] border border-[#E4EBF3] bg-white px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[1em] font-semibold text-[#24364A]">{group.title}</div>
                                  <div className="mt-1 text-[0.88em] text-[#7B8DA2]">
                                    共 {group.items.length} 条证据片段，已按同一文档归并
                                  </div>
                                </div>
                                <span className="shrink-0 rounded-full border border-[#D9E4F0] bg-[#F8FBFF] px-2.5 py-1 text-[0.88em] text-[#6B7F95]">
                                  {group.sourceType || 'doc'}
                                </span>
                              </div>
                              <div className="mt-3 space-y-2">
                                {group.items.slice(0, 2).map((evidence) => (
                                  <button
                                    key={evidence.id}
                                    onClick={() => {
                                      setSelectedEvidenceId(evidence.id);
                                      setRightPanelVisible(true);
                                      if (canOpenEvidenceDoc(evidence)) handleOpenDocPreview(evidence.docId, evidence.snippet);
                                    }}
                                    className={`block w-full rounded-[14px] border border-[#E8EEF5] bg-[#F8FBFF] px-3 py-2.5 text-left transition ${
                                      canOpenEvidenceDoc(evidence) ? 'hover:border-[#D8E5F2] hover:bg-white' : 'cursor-default'
                                    }`}
                                  >
                                    <div className="line-clamp-2 text-[0.94em] leading-6 text-[#53677D]">{evidence.snippet}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {active && message.knowledgePanel?.followUpQuestions?.length ? (
                    <div className="mt-4 space-y-2">
                      {message.knowledgePanel.followUpQuestions.map((question) => (
                        <button
                          key={question}
                          onClick={() => handleKnowledgeQuestion(question)}
                          className="flex w-full items-center justify-between rounded-[14px] bg-[#FAFAFA] px-4 py-3 text-left text-[1em] text-[#333] transition hover:bg-[#F4F4F4]"
                        >
                          <span>{question}</span>
                          <ArrowRight className="h-4 w-4 text-[#666]" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {active && message.references.length > 0 && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {message.references.slice(0, 2).map((ref, index) => (
                        <button
                          key={ref.id}
                          onClick={() => handleOpenDocPreview(ref.id)}
                          className="rounded-[18px] bg-[#FCFCFC] p-4 text-left shadow-[0_10px_24px_rgba(0,0,0,0.02)] transition hover:bg-white"
                        >
                          <div className="mb-2 flex items-center gap-3 text-[1em] text-[#404040]">
                            <ReferenceBadge iconText={index === 0 ? '百' : '馆'} />
                            {ref.title}
                          </div>
                          <div className="text-[1.08em] text-[#232323]">{ref.title}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="relative flex shrink-0 flex-col px-3 pb-3 pt-0 sm:px-4 md:px-5 lg:px-5 xl:px-6">
          <div
            style={{ height: inputDockHeightPx }}
            className={`relative mx-auto flex min-h-0 w-full max-w-full flex-col overflow-hidden rounded-[30px] border border-[#ECECEC] bg-white shadow-[0_18px_42px_rgba(0,0,0,0.07)] ${
              !isInputDockDragging ? 'transition-[height] duration-200' : ''
            }`}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="在卡片上边缘拖拽调节输入区高度，双击恢复默认"
              title="沿卡片上边缘拖拽调节高度；双击恢复默认"
              onPointerDown={attachInputDockResize}
              onDoubleClick={(e) => {
                e.preventDefault();
                resetInputDockHeight();
              }}
              className={`absolute inset-x-0 top-0 z-20 -translate-y-1/2 cursor-row-resize touch-none select-none bg-transparent py-2 ${
                isInputDockDragging ? 'bg-black/[0.04]' : ''
              }`}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-3 pt-4 md:px-7">
              <div className="flex shrink-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden border-b border-[#EEF2F7] pb-3 [-webkit-overflow-scrolling:touch]">
                {recommendedQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => handleSendMessage(question, currentChatMode)}
                    className="inline-flex w-fit max-w-[min(38rem,93vw)] shrink-0 rounded-2xl border border-[#DCE6F2] bg-[#F8FBFE] px-3 py-2 text-left text-[0.94em] leading-snug text-[#4D647C] transition hover:border-[#BFD4F4] hover:bg-white"
                  >
                    <span className="line-clamp-2 block max-w-full">{question}</span>
                  </button>
                ))}
              </div>
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="请输入你的问题跟我聊聊～"
                className="min-h-0 flex-1 basis-0 w-full resize-none overflow-y-auto border-none bg-transparent text-[1.05em] text-[#222] outline-none placeholder:text-[#C9CDD5]"
                rows={2}
              />
              <div className="mt-auto shrink-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex gap-3 overflow-x-auto pb-0.5">
                  {CHAT_MODE_OPTIONS.map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => handleSelectChatMode(mode.key)}
                      className={`whitespace-nowrap rounded-full border px-4 py-2 text-[1em] transition ${
                        currentChatMode === mode.key
                          ? 'border-[#8CB5F2] bg-[#EEF5FF] text-[#2457C5]'
                          : 'border-[#E2E8F0] bg-white text-[#334155] hover:border-[#C9D8EC] hover:bg-[#FAFCFF]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-4 text-[#2D2D2D]">
                  <button title="语音入口" className="rounded-full p-1 hover:bg-[#F5F5F5]">
                    <Mic className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleSendMessage()}
                    className="rounded-full bg-[#2457C5] p-3 text-white shadow-[0_8px_18px_rgba(36,87,197,0.22)] transition hover:translate-y-[-1px]"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-[0.95em] text-[#C0C0C0]">内容为AI生成，使用请注意辨别</div>
        </div>
      </div>

      {rightPanelVisible && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调节知识清单宽度，双击恢复默认"
          title="拖拽调节宽度；双击恢复默认"
          onPointerDown={(e) => attachChatLayoutResize('right', e)}
          onDoubleClick={(e) => {
            e.preventDefault();
            resetChatLayoutWidths();
          }}
          className="relative hidden shrink-0 touch-none select-none lg:flex lg:w-2 lg:items-stretch lg:justify-center"
        >
          <div className="my-6 flex w-full cursor-col-resize items-center justify-center rounded-full border border-transparent py-10 text-[#9AA7B8] transition hover:border-[#D0D9E8] hover:bg-[#EEF2F8] hover:text-[#5A6B80]">
            <GripVertical className="h-5 w-5 shrink-0" aria-hidden />
          </div>
        </div>
      )}

      <div
        style={{
          width: rightPanelVisible ? rightAsidePx : undefined,
        }}
        className={`hidden min-h-0 min-w-0 lg:flex lg:shrink-0 ${
          rightPanelVisible ? '' : 'lg:w-[56px]'
        } ${rightPanelVisible && !isLayoutDragging ? 'lg:transition-[width] lg:duration-200' : ''}`}
      >
        {rightPanelVisible ? (
          <aside className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-[#F8FAFD] shadow-[0_18px_40px_rgba(97,118,146,0.08)]">
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden"
              style={{ fontSize: `${rightKnowledgePanelFontPx}px` }}
            >
              <div className="flex items-center justify-between gap-[0.65em] border-b border-[#E8E8E8] px-[1.15em] py-[1.15em]">
                <div className="min-w-0 flex-1 break-words text-[1.38em] font-semibold leading-tight text-[#202020]">
                  知识清单
                </div>
                <button
                  type="button"
                  onClick={() => setRightPanelVisible(false)}
                  className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-full p-[0.35em] hover:bg-white"
                  title="收起知识清单"
                >
                  <PanelRightClose className="h-[1.05em] w-[1.05em]" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-[1em] py-[1em]">
                {activeAnswer?.knowledgePanel ? (
                  <div className="space-y-[1em]">
                    <div className="overflow-hidden rounded-[1.35em] border border-[#DDE6F2] bg-white shadow-[0_14px_30px_rgba(90,115,144,0.07)]">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setGraphModalOpen(true)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setGraphModalOpen(true);
                          }
                        }}
                        className="group block w-full cursor-pointer p-[1em] text-left"
                      >
                        <div className="rounded-[1.1em] border border-[#E4ECF5] bg-[#F8FBFF] p-[1em] transition group-hover:border-[#D4E1F0] group-hover:bg-[#F5F9FE]">
                          <div className="flex flex-wrap items-start justify-between gap-[0.65em]">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-[0.5em] text-[1.15em] font-semibold text-[#26384A]">
                                <Network className="h-[1.05em] w-[1.05em] shrink-0 text-[#6483A2]" />
                                <span className="break-words">图谱概览</span>
                              </div>
                              <div className="mt-[0.35em] break-words text-[1em] leading-snug text-[#70849A]">
                                节点关系预览，点击查看完整力导向图。
                              </div>
                            </div>
                            <div className="shrink-0 rounded-full border border-[#DEE8F2] bg-white px-[0.65em] py-[0.25em] text-[0.92em] leading-snug text-[#6B7F95]">
                              {activeAnswer.knowledgePanel.mindMap.nodes.length} 节点 / {activeAnswer.knowledgePanel.mindMap.edges.length} 关系
                            </div>
                          </div>
                          <div className="mt-[1em] overflow-hidden rounded-[1.1em] border border-[#E1EAF4] bg-white">
                            <MindMapPreview
                              mindMap={activeAnswer.knowledgePanel.mindMap}
                              selectedNodeId={selectedNode?.id || null}
                              onSelectNode={(id) => setSelectedNodeId(id)}
                              compact
                            />
                          </div>
                          <div className="mt-[0.75em] flex flex-wrap items-center justify-between gap-[0.65em] border-t border-[#E7EEF6] pt-[0.75em]">
                            <div className="min-w-0 flex-1">
                              <div className="text-[0.92em] text-[#7B8DA2]">当前问题</div>
                              <div className="mt-[0.35em] break-words text-[1.15em] font-medium leading-snug text-[#203245]">
                                {messages.filter((item) => item.role === 'user').slice(-1)[0]?.content || '当前问题'}
                              </div>
                            </div>
                            <div className="shrink-0 rounded-full border border-[#D8E4F0] bg-white p-[0.45em] text-[#6D8197] transition group-hover:border-[#C3D5EA] group-hover:text-[#4B6783]">
                              <ArrowRight className="h-[1.05em] w-[1.05em]" />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[#EEF2F6] px-[1em] pb-[1em] pt-[1em]">
                        <div className="overflow-hidden rounded-[1.1em] border border-[#E5EAF1] bg-white">
                          <div className="grid grid-cols-[5.5em_6.75em_minmax(0,1fr)] bg-[#F4F6F8] text-[1em] font-medium text-[#4A5662]">
                            <div className="border-r border-[#E5EAF1] px-[0.65em] py-[0.65em]">主题</div>
                            <div className="border-r border-[#E5EAF1] px-[0.65em] py-[0.65em]">知识</div>
                            <div className="px-[0.65em] py-[0.65em]">描述</div>
                          </div>
                          {activeAnswer.knowledgePanel.tableRows.map((row, index) => (
                            <div
                              key={`${row.topic}-${index}`}
                              className="grid grid-cols-[5.5em_6.75em_minmax(0,1fr)] border-t border-[#EEF2F6] text-[1em] leading-snug text-[#485565]"
                            >
                              <div className="break-words border-r border-[#EEF2F6] px-[0.65em] py-[0.65em] text-[#2E3640]">{row.topic}</div>
                              <div className="break-words border-r border-[#EEF2F6] px-[0.65em] py-[0.65em] text-[#31465B]">{row.knowledge}</div>
                              <div className="break-words px-[0.65em] py-[0.65em]">{row.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[1.1em] border border-[#E4EAF1] bg-white shadow-[0_12px_24px_rgba(105,125,151,0.05)]">
                      <div className="flex flex-wrap items-center gap-[0.5em] border-b border-[#EEF2F6] px-[1em] py-[0.85em] text-[1.23em] font-semibold text-[#263240]">
                        <BrainCircuit className="h-[1.05em] w-[1.05em] shrink-0 text-[#5D6F86]" />
                        <span className="break-words">证据片段</span>
                      </div>
                      <div className="space-y-[0.75em] px-[1em] py-[1em]">
                        {groupedActiveEvidence.length > 0 ? groupedActiveEvidence.map((group) => {
                          const groupSelected = group.items.some((item) => item.id === selectedEvidenceId);
                          return (
                            <div
                              key={group.id}
                              className={`rounded-[1em] border px-[1em] py-[0.85em] transition ${
                                groupSelected ? 'border-[#C9DCF2] bg-[#F4F8FD]' : 'border-[#EBF0F5] bg-[#F8FBFE]'
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-[0.65em]">
                                <div className="min-w-0 flex-1">
                                  <div className="mb-[0.25em] break-words text-[1.15em] font-semibold leading-snug text-[#213042]">{group.title}</div>
                                  <div className="break-words text-[0.92em] leading-snug text-[#7B8DA2]">
                                    共 {group.items.length} 条片段，已归并到同一文档模块
                                  </div>
                                </div>
                                <span className="shrink-0 rounded-full border border-[#DCE6F2] bg-white px-[0.5em] py-[0.25em] text-[0.92em] leading-snug text-[#6D8197]">
                                  {group.sourceType}
                                </span>
                              </div>
                              <div className="mt-[0.75em] space-y-[0.5em]">
                                {group.items.map((item, snippetIndex) => (
                                  <button
                                    key={item.id}
                                    onClick={() => {
                                      setSelectedEvidenceId(item.id);
                                      if (canOpenEvidenceDoc(item)) handleOpenDocPreview(item.docId, item.snippet);
                                    }}
                                    className={`block w-full rounded-[0.85em] border px-[0.65em] py-[0.65em] text-left transition ${
                                      selectedEvidenceId === item.id
                                        ? 'border-[#C9DCF2] bg-white'
                                        : `border-[#E5ECF4] bg-white/80 ${canOpenEvidenceDoc(item) ? 'hover:border-[#D7E4F1] hover:bg-white' : ''}`
                                    }`}
                                  >
                                    <div className="flex items-start gap-[0.65em]">
                                      <span className="mt-[0.15em] inline-flex min-h-[1.35em] min-w-[1.35em] shrink-0 items-center justify-center rounded-full bg-[#EAF1FB] px-[0.35em] text-[0.85em] font-semibold text-[#4B6783]">
                                        {snippetIndex + 1}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="break-words text-[1em] leading-snug text-[#617386]">{item.snippet}</div>
                                        <div className="mt-[0.35em] break-words text-[0.92em] leading-snug text-[#7B8DA2]">{item.claim}</div>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        }) : (
                          <div className="rounded-[1em] border border-dashed border-[#D8E3EF] bg-[#FBFCFE] px-[1em] py-[1.15em] text-[1.08em] leading-snug text-[#7A8CA1]">
                            本轮回答暂未返回独立证据片段；若知识库命中成功，这里会展示原文摘录与对应论点。
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[1.1em] border border-[#E4EAF1] bg-white shadow-[0_12px_24px_rgba(105,125,151,0.05)]">
                      <div className="flex flex-wrap items-center gap-[0.5em] border-b border-[#EEF2F6] px-[1em] py-[0.85em] text-[1.23em] font-semibold text-[#263240]">
                        <FileText className="h-[1.05em] w-[1.05em] shrink-0 text-[#5D6F86]" />
                        <span className="break-words">来源文档</span>
                      </div>
                      <div className="space-y-[0.75em] px-[1em] py-[1em]">
                        {activeAnswer.references.length > 0 ? activeAnswer.references.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleOpenDocPreview(item.id)}
                            className="flex w-full items-center justify-between gap-[0.65em] rounded-[1em] border border-[#EBF0F5] bg-[#F8FBFE] px-[1em] py-[0.85em] text-left transition hover:bg-[#F1F6FB]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-[1.15em] font-semibold leading-snug text-[#213042]">{item.title}</div>
                              <div className="mt-[0.25em] break-words text-[0.92em] text-[#7B8DA2]">{item.type || 'doc'}</div>
                            </div>
                            <ArrowRight className="h-[1.05em] w-[1.05em] shrink-0 text-[#70849A]" />
                          </button>
                        )) : (
                          <div className="rounded-[1em] border border-dashed border-[#D8E3EF] bg-[#FBFCFE] px-[1em] py-[1.15em] text-[1.08em] leading-snug text-[#7A8CA1]">
                            当前回答未附带独立来源文档。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="break-words rounded-[1.1em] bg-white p-[1.15em] text-[1.15em] leading-snug text-[#888]">
                    完成一轮问答后，这里会自动生成知识清单。
                  </div>
                )}
              </div>
            </div>
          </aside>
        ) : (
          <div className="flex w-full items-center justify-center border-l border-[#E2E8F0] bg-[#F8FAFD]">
            <button
              onClick={() => setRightPanelVisible(true)}
              className="inline-flex h-16 w-10 items-center justify-center rounded-l-[18px] border border-r-0 border-[#DCE5F1] bg-white/95 text-[#44566E] shadow-[0_10px_24px_rgba(91,115,143,0.14)] backdrop-blur-sm"
              title="展开知识清单"
            >
              <PanelRightOpen className="h-[1.05em] w-[1.05em]" />
            </button>
          </div>
        )}
      </div>

      {graphModalOpen && activeAnswer?.knowledgePanel && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(0,0,0,0.30)] px-8 pb-8 pt-6 backdrop-blur-[2px]">
          <div className="grid h-[92vh] w-full max-w-[1540px] grid-cols-[minmax(0,1fr)_360px] overflow-hidden rounded-[28px] border border-[#E4EBF4] bg-white shadow-[0_24px_72px_rgba(15,23,42,0.16)]">
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-[#E8EEF6] bg-[#FCFDFF] px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#EEF4FF] text-[#2F6BFF]">
                      <Network className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#EEF4FF] px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]">
                          力导向图谱
                        </span>
                        <span className="rounded-full bg-[#F5F7FB] px-2.5 py-1 text-xs font-medium text-[#64748B]">
                          {activeAnswer.knowledgePanel.mindMap.nodes.length} 节点 / {activeAnswer.knowledgePanel.mindMap.edges.length} 关系
                        </span>
                      </div>
                      <h2 className="mt-3 truncate text-[28px] font-bold leading-tight text-[#162033]">
                        {messages.filter((item) => item.role === 'user').slice(-1)[0]?.content || '当前问题'}
                      </h2>
                      <p className="mt-2 text-sm text-[#6B7B8F]">
                        结构化展示当前问答中的风险判断、支持资源与干预动作之间的关系。
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setGraphModalOpen(false)} className="shrink-0 rounded-2xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-medium text-[#516276] transition hover:bg-[#F8FAFC]">
                    关闭
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 p-4 lg:p-5">
                <MindMapPreview
                  mindMap={activeAnswer.knowledgePanel.mindMap}
                  selectedNodeId={selectedNode?.id || null}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                />
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto border-l border-[#E8EEF6] bg-[#FBFCFE] px-5 py-5">
              <div className="space-y-4">
                <div className="rounded-[22px] border border-[#E7EDF7] bg-[#F7FAFD] p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[18px] font-semibold text-[#162033]">节点详情</div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selectedNode ? getMindMapNodeTheme(selectedNode.group).chip : 'bg-[#F2F6FB] text-[#6B7F95]'}`}>
                      {selectedNode ? getMindMapGroupLabel(selectedNode.group) : '未选中'}
                    </span>
                  </div>
                  <div className="text-[18px] font-semibold leading-7 text-[#213042]">
                    {selectedNode?.label || activeAnswer.knowledgePanel.mindMap.summary}
                  </div>
                  <div className="mt-3 text-[14px] leading-7 text-[#52657A]">
                    {selectedNode?.description || '该视图展示当前问答中的风险判断、支持资源与处置动作之间的联动关系。'}
                  </div>
                </div>

                <div className="rounded-[22px] border border-[#E7EDF7] bg-[#F7FAFD] p-5">
                  <div className="mb-3 text-[18px] font-semibold text-[#162033]">关联关系</div>
                  <div className="space-y-2">
                    {selectedRelations.length > 0 ? selectedRelations.map((item, index) => (
                      <div key={`${item.node?.id}-${index}`} className="rounded-[16px] border border-[#DCE7F5] bg-white px-3 py-3">
                        <div className="text-[12px] font-medium text-[#7A8DA4]">{item.edgeLabel}</div>
                        <div className="mt-1 text-[14px] font-medium leading-6 text-[#27384A]">{item.node?.label}</div>
                      </div>
                    )) : (
                      <div className="text-[14px] leading-7 text-[#66788C]">当前节点暂无额外关联关系。</div>
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-[#E7EDF7] bg-[#F7FAFD] p-5">
                  <div className="mb-3 text-[18px] font-semibold text-[#162033]">补充说明</div>
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-[12px] font-medium text-[#7A8DA4]">关联证据</div>
                      <div className="text-[15px] leading-7 text-[#444]">
                        {selectedEvidence?.snippet || activeAnswer.evidenceList?.[0]?.snippet || '这里展示与节点联动的证据说明。'}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-[12px] font-medium text-[#7A8DA4]">结构摘要</div>
                      <div className="text-[14px] leading-7 text-[#52657A]">
                        {activeAnswer.knowledgePanel.mindMap.summary}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingSessionId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.22)] p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[420px] rounded-[24px] border border-[#E5ECF4] bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
            <div className="text-[20px] font-semibold text-[#1F2E43]">重命名会话</div>
            <div className="mt-2 text-[14px] text-[#7C8DA3]">标题会优先显示在左侧会话列表中。</div>
            <input
              autoFocus
              value={editingSessionTitle}
              onChange={(event) => setEditingSessionTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleRenameSession();
                }
              }}
              placeholder="请输入会话标题"
              className="mt-5 w-full rounded-[16px] border border-[#DCE6F1] px-4 py-3 text-[15px] text-[#1F2E43] outline-none transition focus:border-[#8DB2F3] focus:ring-4 focus:ring-[#EAF2FF]"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingSessionId(null);
                  setEditingSessionTitle('');
                }}
                className="rounded-[14px] border border-[#E2E8F0] px-4 py-2.5 text-[14px] text-[#516276] transition hover:bg-[#F8FAFC]"
              >
                取消
              </button>
              <button
                onClick={handleRenameSession}
                className="rounded-[14px] bg-[#2F6BFF] px-4 py-2.5 text-[14px] text-white shadow-[0_10px_24px_rgba(47,107,255,0.2)] transition hover:bg-[#255CE0]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
