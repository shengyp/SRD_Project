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
  riskSignals: ['高危言语信号', '绝望与无助表达', '行为退缩与失控'],
  evidence: ['对话线索', '量表结果', '既往危机事件'],
  support: ['家庭支持系统', '同伴与班级支持', '校内外专业求助'],
  action: ['风险分级评估', '即时安抚陪伴', '紧急转介处置'],
};

function pickDomainKeywords(question: string, content: string): string[] {
  const text = `${question} ${content}`;
  const candidates: string[] = [];
  if (/自杀|轻生|活着没意义|不想活|结束生命/i.test(text)) candidates.push('高危言语信号');
  if (/绝望|无助|崩溃|抑郁|焦虑|情绪|压抑|失眠/i.test(text)) candidates.push('情绪失衡线索');
  if (/自残|伤害自己|冲动|离家|拒学|失控/i.test(text)) candidates.push('行为失控风险');
  if (/量表|评分|分数|phq|gad|睡眠/i.test(text)) candidates.push('量表结果解读');
  if (/家长|父母|家庭|老师|辅导员|同学|朋友/i.test(text)) candidates.push('支持系统协同');
  if (/转介|医院|热线|求助|报警|120|专业机构/i.test(text)) candidates.push('危机转介路径');
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
      keywords[0] || '高危言语信号',
      keywords[1] || '情绪失衡线索',
      keywords[2] || '行为失控风险',
      keywords[3] || '支持系统协同',
      keywords[4] || '量表结果解读',
      keywords[5] || '危机转介路径',
    ],
    (item) => item,
  ).slice(0, 6);
  const nodes: MindMapNode[] = [
    {
      id: 'question',
      label: question.length > 16 ? `${question.slice(0, 16)}...` : question,
      group: 'question',
      description: '当前问答的核心问题，右侧知识清单、证据链和干预建议都围绕这一节点展开。',
      relatedEvidenceIds: evidenceList.map((item) => item.id),
    },
    ...seeds.map((seed, index): MindMapNode => ({
      id: `node-${index}`,
      label: seed,
      group: toMindMapGroup(index < 3 ? 'core' : index < 5 ? 'support' : 'action'),
      description:
        index === 0
          ? '优先识别是否存在直接、自伤或放弃生命相关表达，这是风险研判的第一信号。'
          : index === 1
            ? '观察绝望、麻木、持续低落、明显焦虑等情绪变化，判断风险是否持续升级。'
            : index === 2
              ? '结合退缩、失眠、冲动、自伤准备等行为线索，补全对当前危机程度的判断。'
              : index === 3
                ? '评估家庭、同伴、学校支持是否真实可用，决定陪伴与看护是否足够。'
                : index === 4
                  ? '把对话中的判断映射到量表或已有记录，形成更可解释的证据依据。'
                  : '明确是否需要立即联系家属、老师、医院或专业热线，形成下一步处置路径。',
      relatedEvidenceIds: evidenceList[index] ? [evidenceList[index].id] : evidenceList[0] ? [evidenceList[0].id] : [],
    })),
  ];
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      source: 'question',
      target: node.id,
      label: index < 3 ? '风险识别' : index < 5 ? '证据补强' : '干预处置',
    })),
    summary: '围绕当前问答串联风险信号、情绪行为、量表评估、支持系统与干预转介。',
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
        topic: '风险识别',
        knowledge: '高危言语、情绪失衡、行为失控',
        description: '先识别是否出现轻生、绝望、退缩、冲动等警讯，再结合当前对话判断风险是否升级。',
      },
      {
        topic: '证据依据',
        knowledge: '对话线索、量表结果、既往记录',
        description: '把回答中的关键判断映射到量表分数、历史危机事件、家校观察记录和参考工作指引。',
      },
      {
        topic: '干预建议',
        knowledge: '陪伴安抚、家校联动、专业转介',
        description: '根据当前风险等级确定是否需要持续陪伴、联系家属老师，或进一步转介到医院与专业机构。',
      },
    ],
    preKnowledge: [
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.riskSignals[0],
        0,
        'pre',
        '先确认是否出现直接表达轻生、放弃生命、告别或安排后事等高危言语，这是最优先识别的危险信号。',
        '请结合当前对话，梳理有哪些高危言语信号需要立即关注，并解释它们对应的风险含义。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.riskSignals[1],
        1,
        'pre',
        '重点观察绝望、无助、麻木、强烈自责等情绪体验，它们通常决定风险是短时波动还是持续累积。',
        '请分析当前案例中的绝望、无助或强烈自责表达，它们对风险研判意味着什么？',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.riskSignals[2],
        2,
        'pre',
        '行为退缩、突然告别、拒学离群、冲动失控等线索，常常是高风险状态进入现实行动前的重要提示。',
        '请结合当前信息说明有哪些行为线索提示风险正在上升，以及应如何继续核实。',
      ),
    ],
    relatedKnowledge: [
      makeItem(
        '量表结果如何辅助判断',
        0,
        'related',
        'PHQ-9、GAD-7、睡眠或压力相关量表可以作为辅助证据，但不能替代对话中的风险判断。',
        '请说明当前问答中如果结合量表结果，应该如何辅助判断风险等级与干预优先级。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.support[0],
        1,
        'related',
        '家庭是否知情、能否持续陪伴、是否存在冲突或忽视，会直接影响后续干预是否可执行。',
        '请从家庭支持角度分析，当前情况里哪些资源可用，哪些地方需要补位。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.support[2],
        2,
        'related',
        '当个体难以独自承受时，需要尽快接入热线、校内心理中心、医院或本地专业求助渠道。',
        '请整理当前情境下可以建议的求助资源，并说明各自适用的场景。',
      ),
    ],
    deepDiveItems: [
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.action[0],
        0,
        'deep',
        '将风险区分为关注、预警、高危和紧急处置层级，有助于统一团队判断和后续响应。',
        '请结合当前案例做一版风险分级，并说明每一级的依据是什么。',
      ),
      makeItem(
        '陪伴与转介路径',
        1,
        'deep',
        '从即时安抚、限制独处、联系家属，到转介医院或心理机构，需要形成清晰可执行的路径。',
        '请给出当前情境下更具体的陪伴方案和转介路径，按时间顺序说明。',
      ),
      makeItem(
        DOMAIN_KNOWLEDGE_LIBRARY.action[2],
        2,
        'deep',
        '当出现明确计划、工具准备、无法保证安全时，应立刻升级处置，不再停留在普通安慰层面。',
        '请说明在什么情况下应立即联系家属、老师或专业机构，并进入紧急处置流程。',
      ),
    ],
    followUpQuestions: [
      '当前对话里有哪些高危信号需要立即关注？',
      '如果家属或老师介入，下一步陪伴和沟通应该怎么做？',
      '在什么情况下应该建议立即联系专业机构或紧急求助？',
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
    <div className={`relative overflow-hidden rounded-[22px] border border-[#E0EAF4] bg-[linear-gradient(180deg,#EEF5FD_0%,#E9F1FB_100%)] ${compact ? 'h-[190px]' : 'h-[520px]'}`}>
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: 'radial-gradient(#8FB3D4 1px, transparent 1px)',
          backgroundSize: '58px 58px',
        }}
      />
      <div className="absolute inset-x-4 top-3 flex items-center justify-between text-[12px] text-[#9AAABD]">
        <span>风险识别图谱</span>
        <span>节点联动</span>
      </div>
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
                stroke={selectedNodeId === edge.target ? '#F09E82' : '#C9D8E7'}
                strokeWidth={selectedNodeId === edge.target ? 2.6 : 1.4}
              />
              {edge.label && !compact && (
                <text
                  x={`${(source.x + target.x) / 2}%`}
                  y={`${(source.y + target.y) / 2}%`}
                  textAnchor="middle"
                  fill="#97A4B0"
                  fontSize="12"
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
            ? 'from-[#6E63DB] to-[#5448BF]'
            : node.group === 'action'
              ? 'from-[#FFD168] to-[#F2A543]'
              : node.group === 'support'
                ? 'from-[#9EDFC0] to-[#5DCC8D]'
                : 'from-[#FFBFC8] to-[#F68B96]';
        const labelPalette =
          node.group === 'question'
            ? 'bg-white/88 text-[#4437A9]'
            : node.group === 'action'
              ? 'bg-[#FFF4D8] text-[#8A5A16]'
              : node.group === 'support'
                ? 'bg-[#E5F8ED] text-[#2E7A4E]'
                : 'bg-[#FFE8EC] text-[#A04656]';
        return (
          <button
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-left"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={node.label}
          >
            <span className={`mb-2 inline-flex max-w-[140px] rounded-full px-3 py-1 text-[11px] font-medium shadow-sm ${labelPalette}`}>
              {node.label}
            </span>
            <span
              className={`block rounded-full bg-gradient-to-br ${palette} transition ${selected ? 'ring-4 ring-white/80 shadow-[0_0_0_10px_rgba(255,255,255,.28)]' : 'shadow-[0_10px_20px_rgba(61,94,129,.18)]'}`}
              style={{
                width: compact ? (node.group === 'question' ? 30 : 24) : node.group === 'question' ? 46 : 34,
                height: compact ? (node.group === 'question' ? 30 : 24) : node.group === 'question' ? 46 : 34,
              }}
            />
          </button>
        );
      })}
      {compact ? (
        <div className="absolute inset-x-4 bottom-4 rounded-[18px] bg-white/82 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[16px] font-semibold text-[#222]">
            <Network className="h-4 w-4 text-[#425EC5]" />
            {mindMap.nodes[0]?.label || '当前问题'}
          </div>
        </div>
      ) : (
        <div className="absolute bottom-4 left-5 right-5 rounded-2xl bg-white/72 px-4 py-3 text-sm text-[#333] backdrop-blur-sm">
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
                  preKnowledge: parsed.slice(0, 2).map((item, index) => ({
                    id: `pre-${index}`,
                    title: String(item),
                    description: `围绕“${String(item)}”补前置知识。`,
                    prompt: `请解释“${String(item)}”并结合当前问题说明作用。`,
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
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-[15px] ${index === 0 ? 'border-[#2F9E98] bg-[#E9FBF8] text-[#0B6F69]' : 'border-[#EAEAEA] bg-white text-[#313131]'}`}
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
                  className="rounded-full bg-[#17233A] p-3 text-white shadow-[0_8px_18px_rgba(23,35,58,0.18)] transition hover:translate-y-[-1px]"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 text-center text-[14px] text-[#C0C0C0]">内容为AI生成，使用请注意辨别</div>
        </div>
      </div>

      <aside className={`hidden lg:flex lg:w-[360px] lg:shrink-0 lg:flex-col lg:border-l lg:border-[#EAEAEA] lg:bg-[#FAFAFA] xl:w-[420px] ${rightPanelVisible ? '' : 'lg:w-0 lg:overflow-hidden lg:border-l-0'}`}>
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
              <div className="rounded-[18px] bg-white p-3">
                <MindMapPreview
                  mindMap={activeAnswer.knowledgePanel.mindMap}
                  selectedNodeId={selectedNode?.id || null}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                  compact
                />
                <button
                  onClick={() => setGraphModalOpen(true)}
                  className="mt-3 flex items-center gap-2 text-[15px] text-[#222]"
                >
                  <Network className="h-4 w-4" />
                  {selectedNode?.label || activeAnswer.knowledgePanel.mindMap.summary}
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
                <div key={group.title} className="rounded-[18px] bg-white px-4 py-4">
                  <div className="mb-3 flex items-center gap-2 text-[18px] font-semibold text-[#262626]">
                    <BrainCircuit className="h-4 w-4" />
                    {group.title}
                  </div>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleKnowledgeQuestion(item.prompt)}
                        className="block w-full rounded-[16px] bg-[#F7F8FB] px-4 py-4 text-left transition hover:bg-[#F2F4F8]"
                      >
                        <div className="mb-2 text-[16px] font-semibold text-[#1F1F1F]">{item.title}</div>
                        <div className="text-[14px] leading-7 text-[#717171]">{item.description}</div>
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
          className="fixed right-6 top-24 z-30 inline-flex items-center gap-2 rounded-full border border-[#E8E8E8] bg-white px-4 py-2 text-[15px] text-[#202020] shadow-sm"
        >
          <PanelRightOpen className="h-4 w-4" />
          知识清单
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
