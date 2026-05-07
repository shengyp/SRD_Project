export interface ScaleQuestionOption {
  value: number;
  label: string;
}

export interface ScaleThreshold {
  min: number;
  max: number;
  level: string;
  label: string;
  label_en?: string;
  risk_level: string;
  suggestion?: string;
}

export interface ScaleQuestion {
  id: number;
  text: string;
  type?: 'single' | 'binary' | 'multiple' | 'text';
  dimension?: string | null;
  reverse?: boolean;
  options: ScaleQuestionOption[];
  module?: string;
  severity_level?: number;
  description?: string;
  is_suicide_item?: boolean;
  is_suicide_related?: boolean;
  note?: string;
}

export interface ScaleScoringDimension {
  id: string;
  name: string;
  name_en?: string;
  questions: number[];
  max_score?: number;
  thresholds?: ScaleThreshold[];
}

export interface ScaleScoring {
  type: string;
  max_score: number;
  max_standard_score?: number;
  dimensions?: ScaleScoringDimension[];
  reverse_questions?: number[];
  suicide_risk_item?: number;
  suicide_risk_all?: boolean;
  note?: string;
}

export interface ScaleDefinition {
  code: string;
  name: string;
  full_name?: string;
  version?: string;
  category?: 'suicide' | 'depression' | 'anxiety' | 'hopelessness' | 'sleep' | 'general';
  description: string;
  purpose?: string;
  estimated_minutes?: number;
  total_questions?: number;
  instruction?: string;
  scoring: ScaleScoring;
  thresholds?: ScaleThreshold[];
  special_rules?: Array<{
    item_id: number;
    condition: string;
    action: string;
    message: string;
  }>;
  questions: ScaleQuestion[];
  interpretation?: string;
  references?: string;
  cutoff_screening?: number;
  cutoff_chinese_population?: number;
}

export interface ScaleMeta {
  code: string;
  name: string;
  full_name: string;
  category: 'depression' | 'anxiety' | 'suicide' | 'hopelessness' | 'sleep' | 'general';
  questionCount: number;
  maxScore: number;
  threshold: number;
  estimatedTime: string;
  color: string;
  bgColor: string;
  description: string;
}

import bhsDefinitionRaw from '../../../scales/BHS.json?raw';
import cssrsDefinitionRaw from '../../../scales/C-SSRS.json?raw';
import dassDefinitionRaw from '../../../scales/DASS-21.json?raw';
import gadDefinitionRaw from '../../../scales/GAD-7.json?raw';
import phqDefinitionRaw from '../../../scales/PHQ-9.json?raw';
import sdsDefinitionRaw from '../../../scales/SDS.json?raw';

const CATEGORY_STYLES: Record<string, { color: string; bgColor: string }> = {
  suicide: { color: 'bg-red-100 text-red-700', bgColor: 'bg-red-500' },
  depression: { color: 'bg-fuchsia-100 text-fuchsia-700', bgColor: 'bg-fuchsia-500' },
  anxiety: { color: 'bg-blue-100 text-blue-700', bgColor: 'bg-blue-500' },
  hopelessness: { color: 'bg-indigo-100 text-indigo-700', bgColor: 'bg-indigo-500' },
  sleep: { color: 'bg-teal-100 text-teal-700', bgColor: 'bg-teal-500' },
  general: { color: 'bg-slate-100 text-slate-700', bgColor: 'bg-slate-500' },
};

const EMPTY_META: ScaleMeta[] = [];

export const SCALES_META: ScaleMeta[] = EMPTY_META;

let loaded = false;
let definitionCache: Record<string, ScaleDefinition> = {};
let metaCache: ScaleMeta[] = [];
const LOCAL_DEFINITION_STRINGS = [
  phqDefinitionRaw,
  cssrsDefinitionRaw,
  gadDefinitionRaw,
  dassDefinitionRaw,
  sdsDefinitionRaw,
  bhsDefinitionRaw,
];

function normalizeScaleCode(code: string): string {
  const compact = code.replace('-', '').replace('－', '').toUpperCase();
  const mapping: Record<string, string> = {
    PHQ9: 'PHQ-9',
    CSSRS: 'C-SSRS',
    GAD7: 'GAD-7',
    DASS21: 'DASS-21',
  };
  return mapping[compact] || code;
}

function pickThreshold(definition: ScaleDefinition): number {
  const hit = (definition.thresholds || []).find((item) => ['medium', 'high'].includes(item.risk_level));
  return hit?.min ?? 0;
}

function toMeta(definition: ScaleDefinition): ScaleMeta {
  const category = definition.category || 'general';
  const styles = CATEGORY_STYLES[category] || CATEGORY_STYLES.general;
  return {
    code: definition.code,
    name: definition.code,
    full_name: definition.name || definition.full_name || definition.code,
    category,
    questionCount: definition.total_questions || definition.questions.length,
    maxScore: definition.scoring.max_standard_score || definition.scoring.max_score,
    threshold: pickThreshold(definition),
    estimatedTime: `约${definition.estimated_minutes || 5}分钟`,
    color: styles.color,
    bgColor: styles.bgColor,
    description: definition.purpose || definition.description || '',
  };
}

export async function loadScalesData(): Promise<void> {
  if (loaded) return;
  definitionCache = {};
  const localDefinitions = LOCAL_DEFINITION_STRINGS.map((item) => JSON.parse(item) as ScaleDefinition);
  metaCache = localDefinitions.map((item) => {
    const code = normalizeScaleCode(item.code);
    const normalized = { ...item, code };
    definitionCache[code] = normalized;
    return toMeta(normalized);
  });
  loaded = true;
}

export function getScaleByCode(code: string): ScaleDefinition | undefined {
  return definitionCache[normalizeScaleCode(code)];
}

export function getScaleMeta(code: string): ScaleMeta | undefined {
  const normalized = normalizeScaleCode(code);
  return metaCache.find((item) => item.code === normalized);
}

export function getAllScalesMeta(): ScaleMeta[] {
  return metaCache;
}

export function getThresholdByScore(code: string, score: number): { label: string; risk_level: string; suggestion?: string } | null {
  const definition = getScaleByCode(code);
  const thresholds = definition?.thresholds || [];
  const hit = thresholds.find((item) => score >= item.min && score <= item.max);
  return hit ? { label: hit.label, risk_level: hit.risk_level, suggestion: hit.suggestion } : null;
}

export function getRiskColors(level: string): { bg: string; text: string; border: string; bgLight: string } {
  const COLORS: Record<string, { bg: string; text: string; border: string; bgLight: string }> = {
    normal: { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-500', bgLight: 'bg-green-50' },
    low: { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-500', bgLight: 'bg-green-50' },
    medium: { bg: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-500', bgLight: 'bg-amber-50' },
    high: { bg: 'bg-rose-500', text: 'text-rose-700', border: 'border-rose-500', bgLight: 'bg-rose-50' },
  };
  return COLORS[level] || COLORS.low;
}

export function getRiskLevelByScore(code: string, score: number): { level: string; label: string; risk_level: string; suggestion?: string } | null {
  const definition = getScaleByCode(code);
  const hit = (definition?.thresholds || []).find((item) => score >= item.min && score <= item.max);
  return hit
    ? { level: hit.level, label: hit.label, risk_level: hit.risk_level, suggestion: hit.suggestion }
    : null;
}

function scoreSDS(answers: Record<number, number>, questions: ScaleQuestion[]): number {
  const raw = questions.reduce((sum, question) => sum + (answers[question.id] ?? 0), 0);
  return Math.round(raw * 1.25);
}

function scoreBHS(answers: Record<number, number>, questions: ScaleQuestion[]): number {
  return questions.reduce((sum, question) => {
    const value = answers[question.id];
    if (value === undefined) return sum;
    if (question.reverse) return sum + (1 - value);
    return sum + value;
  }, 0);
}

function scoreCSSRS(answers: Record<number, number>, questions: ScaleQuestion[]): number {
  let ideationScore = 0;
  let behaviorScore = 0;
  questions.forEach((question) => {
    const value = answers[question.id];
    if (!value) return;
    if (question.id <= 4) ideationScore = Math.max(ideationScore, question.id);
    else behaviorScore = Math.max(behaviorScore, question.id - 4);
  });
  return behaviorScore > 0 ? behaviorScore + 4 : ideationScore;
}

function scoreDASS21(answers: Record<number, number>, definition: ScaleDefinition): { total: number; dimensions: Record<string, number> } {
  const dimensions = Object.fromEntries(
    (definition.scoring.dimensions || []).map((dimension) => [dimension.id, 0])
  ) as Record<string, number>;

  for (const dimension of definition.scoring.dimensions || []) {
    dimensions[dimension.id] = dimension.questions.reduce((sum, qid) => sum + (answers[qid] ?? 0), 0);
  }

  const total = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  return { total, dimensions };
}

export function calculateScaleScore(
  code: string,
  answers: Record<number, number>,
  questions: ScaleQuestion[]
): { total: number; dimensions?: Record<string, number> } {
  const definition = getScaleByCode(code);
  const normalized = normalizeScaleCode(code);
  if (!definition) {
    return { total: Object.values(answers).reduce((sum, value) => sum + value, 0) };
  }

  if (normalized === 'SDS') return { total: scoreSDS(answers, questions) };
  if (normalized === 'BHS') return { total: scoreBHS(answers, questions) };
  if (normalized === 'C-SSRS') return { total: scoreCSSRS(answers, questions) };
  if (normalized === 'DASS-21') return scoreDASS21(answers, definition);

  return {
    total: questions.reduce((sum, question) => sum + (answers[question.id] ?? 0), 0),
  };
}

export function getHighestRiskLevel(riskLevels: string[]): string {
  const order = ['high', 'medium', 'low', 'normal'];
  return riskLevels.reduce((current, item) => {
    return order.indexOf(item) < order.indexOf(current) ? item : current;
  }, 'normal');
}

export function getDimensionThresholds(code: string): Array<{
  id: string;
  name: string;
  thresholds: Array<{ min: number; max: number; label: string; risk_level: string }>;
}> {
  const definition = getScaleByCode(code);
  return (definition?.scoring.dimensions || []).map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    thresholds: (dimension.thresholds || []).map((item) => ({
      min: item.min,
      max: item.max,
      label: item.label,
      risk_level: item.risk_level,
    })),
  }));
}
