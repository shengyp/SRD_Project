import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Copy,
  FilePlus2,
  FileText,
  GitBranch,
  Mic,
  Network,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  RefreshCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  createChatSession,
  fetchChatMessages,
  fetchChatSessions,
  sendChatMessageStream,
  type ChatMessage,
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

interface KnowledgeItem {
  id: string;
  title: string;
  description: string;
  prompt: string;
  relatedEvidenceIds?: string[];
}

interface KnowledgePanelPayload {
  mindMap: MindMapPayload;
  tableRows: Array<{ topic: string; knowledge: string; description: string }>;
  preKnowledge: KnowledgeItem[];
  relatedKnowledge: KnowledgeItem[];
  deepDiveItems: KnowledgeItem[];
  followUpQuestions: string[];
}

interface MessageViewModel {
  id: number | string;
  role: 'user' | 'ai';
  content: string;
  references: ReferenceItem[];
  evidenceList?: EvidenceItem[];
  knowledgePanel?: KnowledgePanelPayload;
  modeLabel?: string;
  durationLabel?: string;
  isGenerating?: boolean;
  feedback?: 'up' | 'down' | null;
  createdAt?: string;
}

const DEFAULT_RECOMMENDED_QUESTIONS = [
  '深度思考',
  '风险识别',
  '干预建议',
  '量表解读',
];

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
      const size = level === 1 ? 'text-[28px]' : level === 2 ? 'text-[24px]' : 'text-[20px]';
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
        items.push(`<li class="leading-8">${formatChatInline(match[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ul class="list-disc pl-6 my-3 text-[16px] text-[#202020]">${items.join('')}</ul>`);
      continue;
    }
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^\s*\d+\.\s+(.+)$/.exec(lines[i]);
        if (!match) break;
        items.push(`<li class="leading-8">${formatChatInline(match[1])}</li>`);
        i += 1;
      }
      blocks.push(`<ol class="list-decimal pl-6 my-3 text-[16px] text-[#202020]">${items.join('')}</ol>`);
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
    blocks.push(`<p class="my-2 text-[16px] leading-8 text-[#232323]">${paragraph.map((item) => formatChatInline(item)).join('<br/>')}</p>`);
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

function normalizeReferences(raw: any): ReferenceItem[] {
  if (!Array.isArray(raw)) return [];
  return uniqueBy(
    raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || item.title || item.docId || ''),
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

const DOMAIN_KNOWLEDGE_LIBRARY = {
  riskSignals: ['即时危险表达', '情绪耗竭轨迹', '现实失控征兆'],
  evidence: ['对话证据片段', '量表与档案交叉验证', '既往危机事件回放'],
  support: ['支持网络可用性', '校园协同响应', '专业转介资源'],
  action: ['风险分层与升级阈值', '陪伴看护执行单', '紧急转介闭环'],
};

function pickDomainKeywords(question: string, content: string): string[] {
  const text = `${question} ${content}`;
  const candidates: string[] = [];
  if (/自杀|轻生|活着没意义|不想活|结束生命|告别/i.test(text)) candidates.push('自杀意念强度');
  if (/计划|方式|时间|地点|工具|跳楼|割腕|吃药/i.test(text)) candidates.push('计划与工具可得性');
  if (/绝望|无助|崩溃|抑郁|焦虑|情绪|压抑|失眠|麻木/i.test(text)) candidates.push('情绪耗竭程度');
  if (/家长|父母|家庭|老师|辅导员|同学|朋友|舍友/i.test(text)) candidates.push('支持网络可用性');
  if (/牵挂|放不下|求助|愿意|还想|责任|家人/i.test(text)) candidates.push('保护性因素');
  if (/转介|医院|热线|求助|报警|120|专业机构/i.test(text)) candidates.push('干预升级路径');
  return uniqueBy([...candidates, ...extractKeywords(question, content)], (item) => item).slice(0, 6);
}

function buildEvidenceList(question: string, content: string, references: ReferenceItem[]): EvidenceItem[] {
  const paragraphs = content.split('\n').map((item) => item.trim()).filter(Boolean);
  const fallback = paragraphs.length > 0 ? paragraphs : ['回答完成后，系统会把关键论据拆成证据链摘要。'];
  const sourceList = references.length > 0
    ? references
    : [
        { id: 'manual', title: '心理危机干预工作手册', type: 'manual' },
        { id: 'guide', title: '青少年心理援助实务指引', type: 'guide' },
      ];
  return sourceList.slice(0, 2).map((ref, index) => ({
    id: `evidence-${ref.id}-${index}`,
    title: ref.title,
    sourceType: ref.type || 'doc',
    snippet: fallback[index % fallback.length].slice(0, 100),
    claim: index === 0 ? `支撑“${question.slice(0, 14)}”的核心风险判断。` : '补充回答中的干预路径、支持依据或求助建议。',
    docId: ref.id,
  }));
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

function buildKnowledgePanel(question: string, content: string, references: ReferenceItem[]): KnowledgePanelPayload {
  const keywords = pickDomainKeywords(question, content);
  const evidenceList = buildEvidenceList(question, content, references);
  const makeItem = (
    title: string,
    index: number,
    promptPrefix: string,
    description: string,
    prompt?: string,
  ): KnowledgeItem => ({
    id: `${promptPrefix}-${index}`,
    title,
    description,
    prompt: prompt || `请围绕“${title}”继续展开说明，并结合当前问题补充解释。`,
    relatedEvidenceIds: evidenceList[index] ? [evidenceList[index].id] : evidenceList[0] ? [evidenceList[0].id] : [],
  });
  return {
    mindMap: buildMindMap(question, keywords, evidenceList),
    tableRows: [
      {
        topic: '问答判断',
        knowledge: '意念强度、行动距离、情绪耗竭',
        description: '先把对话中的危险表达、计划细节和情绪状态拆开看，明确风险究竟停留在想法、准备还是行动边缘。',
      },
      {
        topic: '证据依据',
        knowledge: '对话片段、量表档案、家校观察',
        description: '把结论落回原始证据，避免只给情绪化安慰而没有依据，便于老师或辅导员后续接手。',
      },
      {
        topic: '处置动作',
        knowledge: '陪伴看护、校内协同、紧急转介',
        description: '根据风险层级决定是继续稳定情绪、立即联系家属辅导员，还是直接进入医疗与应急处置。',
      },
    ],
    preKnowledge: [
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.riskSignals[0],
        0,
        'pre',
        '先抓最硬的信号：是否直接说出不想活、想结束生命、想消失、像在告别，或者已经开始交代后事。',
        '请结合当前对话，指出哪些表达属于即时危险表达，并说明它们为什么会触发更高等级处置。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.riskSignals[1],
        1,
        'pre',
        '系统不只看一句“想不开”，还要看绝望、空心感、持续失眠、强烈羞耻或无助是否在持续堆积。',
        '请分析当前案例中的情绪耗竭轨迹，说明它更像短时崩溃还是持续恶化。',
      ),
      makeItem(
        '现实安全约束',
        2,
        'pre',
        '还要确认他现在是不是独处、身边有没有危险工具、今晚有没有人陪、能不能联系到现实中的看护人。',
        '请结合当前信息梳理现实安全约束，包括是否独处、是否有工具、是否有人可立即陪伴。',
      ),
    ],
    relatedKnowledge: [
      makeItem(
        '保护性因素核验',
        0,
        'related',
        '除了危险信号，也要核验还有没有牵挂家人、学业目标、求助意愿、宗教伦理或同伴支持等保护因素。',
        '请结合当前案例分析还有哪些保护性因素可被激活，它们能在多大程度上降低即时风险。',
      ),
      makeItem(
        '量表与档案交叉验证',
        1,
        'related',
        'PHQ-9、GAD-7、既往危机记录和辅导档案是辅助证据，用来校正判断，而不是替代对话本身。',
        '请说明当前问答如果叠加量表分数和既往档案，应如何修正风险判断。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.support[1],
        2,
        'related',
        '对高校场景来说，辅导员、班主任、宿舍同伴、家属和心理中心是否能快速联动，决定了方案能不能真正落地。',
        '请从校园协同角度梳理当前案例最合适的联动顺序和通知对象。',
      ),
    ],
    deepDiveItems: [
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.action[0],
        0,
        'deep',
        '系统最终要把状态落到明确层级，不然老师看完回答还是不知道该不该马上找人、要不要升级。',
        '请结合当前案例做一版风险分层，明确哪些条件会把它从预警推进到高危或紧急。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.action[1],
        1,
        'deep',
        '回答里不能只说“多陪陪他”，而要细化到谁来陪、多久复核一次、哪些话能说、哪些动作要立刻做。',
        '请输出一版可执行的陪伴看护清单，按接下来1小时、今晚、24小时三个时间段拆开。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.action[2],
        2,
        'deep',
        '一旦出现明确计划、工具到手、拒绝保证安全、无法联系陪护人等情况，就不能停留在普通安抚层面。',
        '请说明哪些触发条件意味着必须立刻升级处置，并给出紧急转介闭环步骤。',
      ),
    ],
    followUpQuestions: [
      '这段对话里最需要立即核实的危险细节是什么？',
      '如果今晚只能安排一次现实干预，最优先应该做哪三步？',
      '哪些迹象一旦出现，就必须从普通支持升级为紧急转介？',
    ],
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
    docId: item.docId ? String(item.docId) : undefined,
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
      summary: String(parsed.summary || '知识图谱摘要'),
      focusNodeId: parsed.focusNodeId ? String(parsed.focusNodeId) : undefined,
    };
  }
  return buildMindMap(question, extractKeywords(question, ''), fallbackEvidence);
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

function createAiMessage(message: ChatMessage, question: string): MessageViewModel {
  const references = normalizeReferences(message.references ?? message.referencesJson ?? message.retrievalSources ?? message.retrieval_sources);
  const ragContext = parseJsonSafely(message.ragContext ?? message.rag_context);
  const fallbackEvidence = buildEvidenceList(question, message.content, references);
  const evidenceList = parseEvidencePayload(ragContext?.evidence || ragContext, fallbackEvidence);
  const panel = buildKnowledgePanel(question, message.content, references);
  return {
    id: message.id,
    role: 'ai',
    content: message.content,
    references,
    evidenceList,
    knowledgePanel: {
      ...panel,
      mindMap: parseMindMapPayload(ragContext?.mindMap, question, evidenceList),
    },
    modeLabel: '深度思考',
    durationLabel: message.processingTimeMs ? `用时${(message.processingTimeMs / 1000).toFixed(2)}秒` : undefined,
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

function layoutMindMap(mindMap: MindMapPayload) {
  const positions: Record<string, { x: number; y: number }> = {};
  const baseNodes = mindMap.nodes;
  if (!baseNodes.length) return positions;
  positions[baseNodes[0].id] = { x: 50, y: 56 };
  const layoutSlots = [
    { x: 24, y: 28 },
    { x: 49, y: 18 },
    { x: 77, y: 28 },
    { x: 28, y: 68 },
    { x: 56, y: 73 },
    { x: 79, y: 64 },
  ];
  baseNodes.slice(1).forEach((node, index) => {
    positions[node.id] = layoutSlots[index] || { x: 24 + index * 8, y: 30 + (index % 2) * 28 };
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
  const positions = layoutMindMap(mindMap);
  return (
    <div className={`relative overflow-hidden rounded-[24px] border border-[#DCE7F5] bg-[radial-gradient(circle_at_top,#F8FBFF_0%,#EEF4FB_42%,#E7EEF7_100%)] ${compact ? 'h-[216px]' : 'h-[540px]'}`}>
      <div
        className="absolute inset-0 opacity-35"
        style={{
          backgroundImage: 'radial-gradient(#B8CAE0 1px, transparent 1px)',
          backgroundSize: '42px 42px',
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0)_40%,rgba(111,145,211,0.08)_100%)]" />
      <div className="absolute inset-x-5 top-4 flex items-center justify-between text-[12px] text-[#91A2B5]">
        <span>风险研判图谱</span>
        <span>证据联动</span>
      </div>
      <div className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#B9CBE0]/80" />
      <div className="absolute left-1/2 top-1/2 h-[54%] w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#D1DEEC]/90" />
      <svg className="absolute inset-0 h-full w-full">
        {mindMap.edges.map((edge, index) => {
          const source = positions[edge.source];
          const target = positions[edge.target];
          if (!source || !target) return null;
          return (
            <g key={`${edge.source}-${edge.target}-${index}`}>
              <line
                x1={`${source.x}%`}
                y1={`${source.y}%`}
                x2={`${target.x}%`}
                y2={`${target.y}%`}
                stroke={selectedNodeId === edge.target ? '#7D72D9' : '#C7D5E5'}
                strokeWidth={selectedNodeId === edge.target ? 2.8 : 1.5}
                strokeDasharray={selectedNodeId === edge.target ? '0' : '5 5'}
              />
              {edge.label && !compact && (
                <text
                  x={`${(source.x + target.x) / 2}%`}
                  y={`${(source.y + target.y) / 2}%`}
                  textAnchor="middle"
                  fill="#8FA0B1"
                  fontSize="11"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {mindMap.nodes.map((node) => {
        const pos = positions[node.id];
        if (!pos) return null;
        const selected = selectedNodeId === node.id;
        const palette =
          node.group === 'question'
            ? 'from-[#6E63DB] via-[#5F55CD] to-[#4D44B8]'
            : node.group === 'action'
              ? 'from-[#FFE19A] to-[#F6B44A]'
              : node.group === 'support'
                ? 'from-[#C8EED8] to-[#7ACEA0]'
                : 'from-[#FFD1DA] to-[#F79AA9]';
        const groupLabel =
          node.group === 'question'
            ? '当前问题'
            : node.group === 'action'
              ? '处置动作'
              : node.group === 'support'
                ? '支持资源'
                : '风险判断';
        const labelPalette =
          node.group === 'question'
            ? 'bg-[#EEEAFE] text-[#4C42B1]'
            : node.group === 'action'
              ? 'bg-[#FFF2D6] text-[#96611B]'
              : node.group === 'support'
                ? 'bg-[#E6F7EE] text-[#2F8356]'
                : 'bg-[#FFE8ED] text-[#A74C61]';
        return (
          <button
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-left"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={node.label}
          >
            <span
              className={`block overflow-hidden rounded-[18px] border border-white/70 bg-white/88 shadow-[0_14px_32px_rgba(86,108,139,0.12)] backdrop-blur-sm transition ${selected ? 'scale-[1.02] ring-2 ring-[#8590E8]/70' : 'hover:scale-[1.01]'}`}
              style={{ width: compact ? (node.group === 'question' ? 154 : 126) : node.group === 'question' ? 188 : 156 }}
            >
              <span className={`block h-1.5 w-full bg-gradient-to-r ${palette}`} />
              <span className="block px-3 py-2.5">
                <span className={`mb-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${labelPalette}`}>
                  {groupLabel}
                </span>
                <span className={`block font-semibold leading-5 text-[#1F2937] ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
                  {node.label}
                </span>
                {!compact && (
                  <span className="mt-1.5 line-clamp-2 block text-[12px] leading-5 text-[#6B7B8D]">
                    {node.description}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
      {compact ? (
        <div className="absolute inset-x-4 bottom-4 rounded-[20px] border border-white/80 bg-white/84 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1F2A37]">
            <Network className="h-4 w-4 text-[#4B5EC8]" />
            当前风险工作台
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[#6C7B8C]">{mindMap.summary}</div>
        </div>
      ) : (
        <div className="absolute bottom-4 left-5 right-5 rounded-[20px] border border-white/80 bg-white/78 px-4 py-3 text-sm text-[#334155] backdrop-blur-sm">
          {mindMap.summary}
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<MessageViewModel[]>([]);
  const [recommendedModes] = useState(DEFAULT_RECOMMENDED_QUESTIONS);
  const [inputText, setInputText] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [activeAnswerId, setActiveAnswerId] = useState<number | string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        const [sessionsRes] = await Promise.allSettled([
          fetchChatSessions({ limit: 10 }),
        ]);

        let sessionId: number | null = null;
        if (sessionsRes.status === 'fulfilled' && sessionsRes.value.sessions.length > 0) {
          sessionId = Number(sessionsRes.value.sessions[0].id);
          setCurrentSessionId(sessionId);
          const rawMessages = await fetchChatMessages(sessionId);
          const mapped: MessageViewModel[] = [];
          let lastQuestion = '';
          rawMessages.forEach((message) => {
            if (message.role === 'user') {
              lastQuestion = message.content;
              mapped.push(createUserMessage(message));
            } else if (message.role === 'ai') {
              const ai = createAiMessage(message, lastQuestion || '当前问题');
              mapped.push(ai);
            }
          });
          setMessages(mapped);
          const latestAi = [...mapped].reverse().find((item) => item.role === 'ai') || null;
          setActiveAnswerId(latestAi?.id || null);
          setSelectedNodeId(latestAi?.knowledgePanel?.mindMap.nodes[0]?.id || null);
          setSelectedEvidenceId(latestAi?.evidenceList?.[0]?.id || null);
        }

        if (!sessionId) {
          const newSession = await createChatSession({ aiMode: 'deep_think', contextType: 'general' });
          setCurrentSessionId(Number(newSession.id));
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const updateAiMessage = (messageId: number | string, updater: (message: MessageViewModel) => MessageViewModel) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const handleSendMessage = async (overrideText?: string) => {
    const question = (overrideText ?? inputText).trim();
    if (!question || !currentSessionId) return;

    const userMessage: MessageViewModel = {
      id: Date.now(),
      role: 'user',
      content: question,
      references: [],
      createdAt: new Date().toISOString(),
    };

    const initialPanel = buildKnowledgePanel(question, '', []);
    const placeholderId = Date.now() + 1;
    const aiMessage: MessageViewModel = {
      id: placeholderId,
      role: 'ai',
      content: '',
      references: [],
      evidenceList: buildEvidenceList(question, '', []),
      knowledgePanel: initialPanel,
      modeLabel: '深度思考',
      durationLabel: '用时生成中',
      isGenerating: true,
      feedback: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setInputText('');
    setActiveAnswerId(placeholderId);
    setSelectedNodeId(initialPanel.mindMap.nodes[0]?.id || null);
    setSelectedEvidenceId(aiMessage.evidenceList?.[0]?.id || null);

    let streamedContent = '';

    try {
      await sendChatMessageStream(
        currentSessionId,
        question,
        '深度思考',
        undefined,
        (chunk) => {
          streamedContent += chunk;
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            content: streamedContent,
            isGenerating: true,
          }));
        },
        () => {
          updateAiMessage(placeholderId, (message) => {
            const refs = message.references;
            const evidenceList = message.evidenceList && message.evidenceList.length > 0 ? message.evidenceList : buildEvidenceList(question, streamedContent, refs);
            const panel = message.knowledgePanel || buildKnowledgePanel(question, streamedContent, refs);
            setSelectedEvidenceId(evidenceList[0]?.id || null);
            setSelectedNodeId(panel.mindMap.nodes[0]?.id || null);
            return {
              ...message,
              content: streamedContent,
              evidenceList,
              knowledgePanel: panel,
              durationLabel: `用时${Math.max(3.8, streamedContent.length / 70).toFixed(2)}秒`,
              isGenerating: false,
            };
          });
        },
        (error) => {
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            content: streamedContent || `抱歉，消息发送失败：${error.message}`,
            durationLabel: '生成失败',
            isGenerating: false,
          }));
        },
        (sources) => {
          const refs = normalizeReferences(sources);
          updateAiMessage(placeholderId, (message) => ({
            ...message,
            references: refs,
            evidenceList: buildEvidenceList(question, streamedContent, refs),
            knowledgePanel: buildKnowledgePanel(question, streamedContent, refs),
          }));
        },
        (mindMap) => {
          updateAiMessage(placeholderId, (message) => {
            const refs = message.references;
            const evidenceList = message.evidenceList || buildEvidenceList(question, streamedContent, refs);
            const panel = message.knowledgePanel || buildKnowledgePanel(question, streamedContent, refs);
            return {
              ...message,
              knowledgePanel: {
                ...panel,
                mindMap: parseMindMapPayload(mindMap, question, evidenceList),
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
          updateAiMessage(placeholderId, (message) => {
            const panel = message.knowledgePanel || buildKnowledgePanel(question, streamedContent, message.references);
            const parsed = parseJsonSafely(terms);
            if (Array.isArray(parsed)) {
              return {
                ...message,
                knowledgePanel: {
                  ...panel,
                  preKnowledge: parsed.slice(0, 3).map((item, index) => ({
                    id: `pre-${index}`,
                    title: String(item),
                    description: `围绕“${String(item)}”补齐本轮风险识别里最先要核实的前置信息。`,
                    prompt: `请解释“${String(item)}”在当前自杀风险检测场景中的判断作用，并结合这轮问答展开说明。`,
                  })),
                },
              };
            }
            return message;
          });
        },
      );
    } catch (error) {
      console.error('发送消息失败:', error);
    }
  };

  const handleCopyAnswer = async () => {
    if (!activeAnswer) return;
    try {
      await navigator.clipboard.writeText(activeAnswer.content);
      setCopied(true);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const handleFeedback = (type: 'up' | 'down') => {
    if (!activeAnswer) return;
    updateAiMessage(activeAnswer.id, (message) => ({
      ...message,
      feedback: message.feedback === type ? null : type,
    }));
  };

  const handleOpenDocPreview = (docId?: string) => {
    if (!docId) return;
    navigate(`/doc-preview?id=${docId}`);
  };

  const handleKnowledgeQuestion = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const centerTimestamp = useMemo(() => formatTimestamp(activeAnswer?.createdAt), [activeAnswer?.createdAt]);

  return (
    <div className="relative flex min-h-0 flex-1 gap-6 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[1040px] flex-1 overflow-y-auto px-4 pb-8 pt-3">
          <div className="mb-6 flex justify-center text-[14px] text-[#8C8C8C]">{centerTimestamp}</div>

          {messages.length === 0 && !isLoading && (
            <div className="mt-12 rounded-[28px] border border-[#EEEEEE] bg-white px-8 py-10 shadow-[0_12px_36px_rgba(0,0,0,0.04)]">
              <div className="text-center text-[18px] text-[#666]">请输入你的问题跟我聊聊～</div>
            </div>
          )}

          <div className="space-y-5">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="rounded-[16px] bg-[#F2F3F5] px-5 py-3 text-[18px] text-[#4A4A4A]">
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
                  <div className="mb-4 flex items-center gap-3 text-[16px] text-[#212121]">
                    <div className="flex items-center gap-2 font-semibold">
                      <Bot className="h-5 w-5 text-[#303030]" />
                      {message.modeLabel || '深度思考'}
                    </div>
                    <div className="text-[#8A8A8A]">({message.durationLabel || '用时生成中'})</div>
                  </div>

                  {message.isGenerating && !message.content ? (
                    <div className="py-8 text-[16px] text-[#8C8C8C]">正在组织回答...</div>
                  ) : (
                    <div
                      className="chat-md text-[16px] text-[#232323] [&_a]:text-[#2F6CA5] [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: renderChatMessageHtml(message.content) }}
                    />
                  )}

                  {message.references.length > 0 && (
                    <div className="mt-6">
                      <div className="inline-flex items-center gap-3 rounded-full border border-[#E9E9E9] bg-white px-4 py-2 text-[15px] text-[#343434] shadow-sm">
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
                      <button className="inline-flex items-center gap-2 text-[15px] font-medium" onClick={() => setRightPanelVisible(true)}>
                        <GitBranch className="h-4 w-4" />
                        知识清单
                      </button>
                      <button className="inline-flex items-center gap-2 text-[15px]" title="第一期仅做展示">
                        <Volume2 className="h-4 w-4" />
                      </button>
                      <button className="inline-flex items-center gap-2 text-[15px]" onClick={handleCopyAnswer}>
                        <Copy className="h-4 w-4" />
                      </button>
                      <button className="inline-flex items-center gap-2 text-[15px]" onClick={() => handleSendMessage(messages.filter((item) => item.role === 'user').slice(-1)[0]?.content || inputText)}>
                        <RefreshCcw className="h-4 w-4" />
                      </button>
                      <button className="inline-flex items-center gap-2 text-[15px]" title="第一期仅做展示">
                        <PencilLine className="h-4 w-4" />
                      </button>
                      <span className="h-5 w-px bg-[#E5E5E5]" />
                      <button
                        className={`inline-flex items-center gap-2 text-[15px] ${message.feedback === 'up' ? 'text-[#2E7D4F]' : ''}`}
                        onClick={() => handleFeedback('up')}
                      >
                        <ThumbsUp className="h-4 w-4" />
                      </button>
                      <button
                        className={`inline-flex items-center gap-2 text-[15px] ${message.feedback === 'down' ? 'text-[#9A4D4D]' : ''}`}
                        onClick={() => handleFeedback('down')}
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {active && message.knowledgePanel?.followUpQuestions?.length ? (
                    <div className="mt-4 space-y-2">
                      {message.knowledgePanel.followUpQuestions.map((question) => (
                        <button
                          key={question}
                          onClick={() => handleKnowledgeQuestion(question)}
                          className="flex w-full items-center justify-between rounded-[14px] bg-[#FAFAFA] px-4 py-3 text-left text-[15px] text-[#333] transition hover:bg-[#F4F4F4]"
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
                          <div className="mb-2 flex items-center gap-3 text-[15px] text-[#404040]">
                            <ReferenceBadge iconText={index === 0 ? '百' : '馆'} />
                            {ref.title}
                          </div>
                          <div className="text-[18px] text-[#232323]">{ref.title}</div>
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

        <div className="relative px-4 pb-4 pt-2">
          <div className="mx-auto w-full max-w-[1120px] rounded-[30px] border border-[#ECECEC] bg-white px-5 pb-4 pt-5 shadow-[0_18px_42px_rgba(0,0,0,0.07)] md:px-7">
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="请输入你的问题跟我聊聊～"
              className="min-h-[66px] w-full resize-none border-none bg-transparent text-[17px] text-[#222] outline-none placeholder:text-[#C9CDD5]"
              rows={1}
            />
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {recommendedModes.map((mode, index) => (
                  <button
                    key={mode}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-[15px] ${index === 0 ? 'border-[#8CB5F2] bg-[#EEF5FF] text-[#2457C5]' : 'border-[#E2E8F0] bg-white text-[#334155]'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-end gap-4 text-[#2D2D2D]">
                <button title="语音入口" className="rounded-full p-1 hover:bg-[#F5F5F5]">
                  <Mic className="h-5 w-5" />
                </button>
                <button title="上传附件" className="rounded-full p-1 hover:bg-[#F5F5F5]">
                  <FilePlus2 className="h-5 w-5" />
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
          <div className="mt-3 text-center text-[14px] text-[#C0C0C0]">内容为AI生成，使用请注意辨别</div>
        </div>
      </div>

      <aside className={`hidden lg:flex lg:w-[360px] lg:shrink-0 lg:flex-col lg:border-l lg:border-[#E2E8F0] lg:bg-[#F8FAFD] xl:w-[420px] ${rightPanelVisible ? '' : 'lg:w-0 lg:overflow-hidden lg:border-l-0'}`}>
        <div className="flex items-center justify-between border-b border-[#E8E8E8] px-5 py-5">
          <div className="flex items-center gap-3 text-[18px] font-semibold text-[#202020]">
            <ArrowRight className="h-5 w-5" />
            知识清单
          </div>
          <button onClick={() => setRightPanelVisible(false)} className="rounded-full p-1.5 hover:bg-white">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activeAnswer?.knowledgePanel ? (
            <div className="space-y-4">
              <div className="rounded-[20px] border border-[#E3EBF5] bg-white p-3 shadow-[0_14px_28px_rgba(104,126,153,0.08)]">
                <MindMapPreview
                  mindMap={activeAnswer.knowledgePanel.mindMap}
                  selectedNodeId={selectedNode?.id || null}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                  compact
                />
                <button
                  onClick={() => setGraphModalOpen(true)}
                  className="mt-3 flex w-full items-center justify-between rounded-[16px] bg-[#F5F8FC] px-4 py-3 text-left text-[14px] text-[#213042] transition hover:bg-[#EEF4FA]"
                >
                  <span className="flex items-center gap-2">
                    <Network className="h-4 w-4" />
                    {selectedNode?.label || '查看完整图谱'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#7A8B9D]" />
                </button>
              </div>

              <div className="overflow-hidden rounded-[18px] border border-[#E3E3E3] bg-white">
                <div className="grid grid-cols-[92px_1fr_1.1fr] bg-[#F1F1F1] text-[14px] text-[#3A3A3A]">
                  <div className="border-r border-[#E2E2E2] px-3 py-3">主题</div>
                  <div className="border-r border-[#E2E2E2] px-3 py-3">知识</div>
                  <div className="px-3 py-3">描述</div>
                </div>
                {activeAnswer.knowledgePanel.tableRows.map((row, index) => (
                  <div key={`${row.topic}-${index}`} className="grid grid-cols-[92px_1fr_1.1fr] border-t border-[#EFEFEF] text-[14px] leading-7 text-[#444]">
                    <div className="border-r border-[#EFEFEF] px-3 py-3">{row.topic}</div>
                    <div className="border-r border-[#EFEFEF] px-3 py-3">{row.knowledge}</div>
                    <div className="px-3 py-3">{row.description}</div>
                  </div>
                ))}
              </div>

              {[
                { title: '前置知识', items: activeAnswer.knowledgePanel.preKnowledge },
                { title: '相关学习', items: activeAnswer.knowledgePanel.relatedKnowledge },
                { title: '深入理解', items: activeAnswer.knowledgePanel.deepDiveItems },
              ].map((group) => (
                <div key={group.title} className="rounded-[20px] border border-[#E7EDF5] bg-white px-4 py-4 shadow-[0_12px_24px_rgba(105,125,151,0.06)]">
                  <div className="mb-3 flex items-center gap-2 text-[18px] font-semibold text-[#262626]">
                    <BrainCircuit className="h-4 w-4" />
                    {group.title}
                  </div>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleKnowledgeQuestion(item.prompt)}
                        className="block w-full rounded-[18px] border border-[#EEF2F7] bg-[#F8FAFD] px-4 py-4 text-left transition hover:bg-[#F1F5FB]"
                      >
                        <div className="mb-2 text-[16px] font-semibold text-[#1E2B38]">{item.title}</div>
                        <div className="text-[14px] leading-7 text-[#5F7084]">{item.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[18px] bg-white p-5 text-[15px] text-[#888]">完成一轮问答后，这里会自动生成知识清单。</div>
          )}
        </div>
      </aside>

      {!rightPanelVisible && (
        <button
          onClick={() => setRightPanelVisible(true)}
          className="fixed right-0 top-1/2 z-30 inline-flex h-16 w-10 -translate-y-1/2 items-center justify-center rounded-l-[18px] border border-r-0 border-[#DCE5F1] bg-white/95 text-[#44566E] shadow-[0_10px_24px_rgba(91,115,143,0.14)] backdrop-blur-sm"
          title="展开知识清单"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      {graphModalOpen && activeAnswer?.knowledgePanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.36)] p-8 backdrop-blur-[2px]">
          <div className="grid h-[88vh] w-full max-w-[1260px] grid-cols-[1fr_320px] overflow-hidden rounded-[26px] bg-white shadow-[0_24px_72px_rgba(0,0,0,0.18)]">
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-[#ECECEC] px-6 py-5">
                <div className="flex items-center gap-3 text-[18px] font-semibold text-[#202020]">
                  <Network className="h-5 w-5" />
                  {messages.filter((item) => item.role === 'user').slice(-1)[0]?.content || '当前问题'}
                </div>
                <button onClick={() => setGraphModalOpen(false)} className="rounded-full p-2 hover:bg-[#F5F5F5]">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 p-5">
                <MindMapPreview
                  mindMap={activeAnswer.knowledgePanel.mindMap}
                  selectedNodeId={selectedNode?.id || null}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                />
                <div className="mt-4 text-[16px] leading-8 text-[#222]">
                  {selectedNode?.description || '该知识图谱主要涉及概念实体和关键关系。'}
                </div>
              </div>
            </div>
            <div className="min-h-0 border-l border-[#ECECEC] bg-[#FAFAFA] px-5 py-5">
              <div className="mb-4 text-[18px] font-semibold text-[#202020]">知识清单</div>
              <div className="space-y-4">
                <div className="rounded-[16px] bg-white p-4 text-[15px] leading-7 text-[#444]">
                  {selectedNode?.label || activeAnswer.knowledgePanel.mindMap.summary}
                </div>
                <div className="rounded-[16px] bg-white p-4 text-[15px] leading-7 text-[#444]">
                  {selectedEvidence?.snippet || activeAnswer.evidenceList?.[0]?.snippet || '这里展示与节点联动的证据说明。'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
