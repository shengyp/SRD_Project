/**
 * VIS4SRD API 服务层
 * 统一管理所有与后端数据库交互的 API 调用
 */

// 心理援助地图相关类型
import type {
  Institution,
  HotLine,
  InstitutionStats,
  HotLineStats,
  CityInfo,
  AuthUser,
} from '../types';

// ==================== API 基础配置 ====================

// 生产环境：通过 Nginx 代理使用相对路径（/api/*）
// 开发环境：使用 .env 中的 VITE_API_BASE
const API_BASE = (() => {
  const envValue = import.meta.env.VITE_API_BASE;
  // 如果环境变量为空字符串、undefined 或 "undefined"，使用相对路径（通过 Nginx 代理）
  if (!envValue || envValue === 'undefined' || envValue === '') {
    return '';
  }
  // 移除末尾的 /api
  return envValue.replace(/\/api$/, '');
})();

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ==================== 通用请求工具 ====================

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // 从 localStorage 读取 JWT Token（authStore persist key = 'vis4srd-auth'）
  let authHeader: Record<string, string> = {};
  try {
    const raw = localStorage.getItem('vis4srd-auth');
    if (raw) {
      const state = JSON.parse(raw);
      if (state?.state?.token) {
        authHeader = { 'Authorization': `Bearer ${state.state.token}` };
      }
    }
  } catch {
    // ignore
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json; charset=utf-8',
      ...authHeader,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
  }

  // 确保响应文本按 UTF-8 解码
  const responseText = await response.text();
  
  // 尝试解析 JSON，如果失败则返回原始文本
  try {
    const result: ApiResponse<T> = JSON.parse(responseText);
    if (!result.success) {
      throw new Error(result.message || '请求失败');
    }
    // 如果 result.data 存在则返回它，否则返回整个 result（某些 API 直接返回数据）
    return result.data !== undefined ? result.data : (result as unknown as T);
  } catch {
    // 如果不是标准 API 响应格式，直接返回解析后的数据
    try {
      return JSON.parse(responseText) as T;
    } catch {
      return responseText as unknown as T;
    }
  }
}

// ==================== 首页 API ====================

export interface HomeStats {
  knowledgeBaseDocs: number;
  totalArchives: number;
  totalPosts: number;
  totalScales: number;
  reportsGenerated: number;
  totalUsers: number;
  riskDistribution: {
    low: { count: number; percentage: number };
    medium: { count: number; percentage: number };
    high: { count: number; percentage: number };
  };
}

export interface HomeTrend {
  date: string;
  scaleCount: number;
  detectionCount: number;
  riskLow: number;
  riskMedium: number;
  riskHigh: number;
}

export async function fetchHomeStats(): Promise<HomeStats> {
  const endpoint = '/api/home/stats';
  try {
    const data = await request<HomeStats>(endpoint);
    return data;
  } catch (error) {
    console.error('获取首页统计失败:', error);
    // 返回默认值
    return {
      knowledgeBaseDocs: 0,
      totalArchives: 0,
      totalPosts: 0,
      totalScales: 0,
      reportsGenerated: 0,
      totalUsers: 0,
      riskDistribution: {
        low: { count: 0, percentage: 0 },
        medium: { count: 0, percentage: 0 },
        high: { count: 0, percentage: 0 },
      },
    };
  }
}

export async function fetchHomeTrend(): Promise<HomeTrend[]> {
  const endpoint = '/api/home/trend';
  try {
    const data = await request<HomeTrend[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取首页趋势数据失败:', error);
    return [];
  }
}

// 首页功能卡片
export interface FunctionCard {
  id: number;
  cardKey: string;
  cardLabel: string;
  cardIcon: string;
  cardColor: string;
  cardBg: string;
  cardRoute: string;
  cardDescription?: string;
  cardOrder?: number;
  isActive?: boolean;
  isNew?: boolean;
}

export async function fetchHomeCards(): Promise<FunctionCard[]> {
  const endpoint = '/api/home/cards';
  try {
    const data = await request<FunctionCard[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取首页功能卡片失败:', error);
    return [];
  }
}

// ==================== 数据集 API ====================

export interface DatasetProfile {
  id: number;
  datasetKey: string;
  displayName: string;
  description: string;
  language: string;
  classSystem: 'binary' | 'multi-class';
  classCount: number;
  fineLabels: Record<string, string>;
  coarseRiskMapping: Record<string, string>;
  totalUsers: number;
  totalPosts: number;
  totalArchives: number;
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
  // UI属性
  icon?: string;
  color?: string;
  bgColor?: string;
  textColor?: string;
  // CSV 路径（前端直接读取静态文件）
  csvPath?: string;
  emojiCsvPath?: string;
}

export async function fetchDatasets(): Promise<DatasetProfile[]> {
  const endpoint = '/api/datasets';
  const data = await request<DatasetProfile[]>(endpoint);
  return data;
}

/** 获取数据集 CSV 文件信息（元信息 + 路径） */
export async function fetchDatasetCSVInfo(datasetKey: string): Promise<{
  datasetKey: string;
  displayName: string;
  csvPath: string;
  emojiCsvPath: string | null;
  totalUsers: number;
  totalPosts: number;
  columns: string[];
  language: string;
  classSystem: string;
  classCount: number;
  fineLabels: Record<string, string>;
  coarseRiskMapping: Record<string, string>;
}> {
  const endpoint = `/api/datasets/csv/${encodeURIComponent(datasetKey)}`;
  const data = await request<any>(endpoint);
  return data;
}

/** 获取数据集档案分页列表（从 CSV 读取） */
export async function fetchCSVArchives(params: {
  datasetKey: string;
  dataset?: string;
  riskLevel?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  archives: DemoArchiveRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const searchParams = new URLSearchParams();
  if (params.dataset) searchParams.set('dataset', params.dataset);
  if (params.riskLevel) searchParams.set('risk_level', params.riskLevel);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('page_size', String(params.pageSize));

  const endpoint = `/api/datasets/${encodeURIComponent(params.datasetKey)}/archives?${searchParams.toString()}`;
  const raw = await request<any>(endpoint);

  // 统一响应格式：兼容 { success, data: { archives, ... } } 和直接 { archives, ... }
  const data = raw?.data ?? raw;
  if (!data?.archives) {
    return { archives: [], total: 0, page: 1, pageSize: params.pageSize ?? 20, totalPages: 0 };
  }

  // 映射后端字段到前端 ArchiveRecord 格式
  const mappedArchives: DemoArchiveRecord[] = data.archives.map((a: any) => ({
    id: a.id || a.userId || a.userHash || '',
    userId: a.userId || a.userHash || a.id || '',
    dataSource: a.datasetSource || params.datasetKey || 'reddit',
    postCount: a.postCount ?? a.post_count ?? 0,
    // riskLevel (coarse) 映射到 riskOverview (中文)
    riskOverview: _mapRiskLevelToChinese(a.riskLevel ?? a.risk_level ?? 'low'),
    // 支持 assessmentTime（后端字段名）或 importTime（前端期望的字段名）
    importTime: a.importTime || a.assessmentTime || a.created_at || new Date().toISOString(),
    lastActive: a.lastActive || a.updated_at,
    status: a.status || 'ready',
    userStats: a.userStats || a.user_stats || { male: 0, female: 0, unknown: 1 },
    hasTimestamp: a.hasTimestamp ?? a.has_timestamp ?? false,
    hasEmojis: a.hasEmojis ?? a.has_emojis ?? false,
    riskLevel: a.riskLevel ?? a.risk_level ?? 'low',
    riskValue: a.riskValue ?? a.risk_value ?? 0,
  }));

  return {
    archives: mappedArchives,
    total: data.total ?? 0,
    page: data.page ?? params.page ?? 1,
    pageSize: data.pageSize ?? data.page_size ?? params.pageSize ?? 20,
    totalPages: data.totalPages ?? data.total_pages ?? 0,
  };
}

/** 将后端风险等级（coarse: low/medium/high）映射为中文 */
function _mapRiskLevelToChinese(level: string): '高风险' | '中风险' | '低风险' {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  return '低风险';
}

/** 获取用户贴文列表（从 CSV 读取） */
export async function fetchCSVPUserPosts(params: {
  datasetKey: string;
  userHash: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  posts: DemoPostRecord[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const searchParams = new URLSearchParams();
  searchParams.set('user_hash', params.userHash);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('page_size', String(params.pageSize));

  const endpoint = `/api/datasets/${encodeURIComponent(params.datasetKey)}/posts?${searchParams.toString()}`;
  const data = await request<any>(endpoint);
  return data;
}

/** 获取用户贴文高频词汇（从 CSV 读取） */
export async function fetchCSVUserKeywords(params: {
  datasetKey: string;
  userHash: string;
  topN?: number;
}): Promise<{ keywords: KeywordItem[]; total: number }> {
  const searchParams = new URLSearchParams();
  searchParams.set('user_hash', params.userHash);
  if (params.topN) searchParams.set('top_n', String(params.topN));

  const endpoint = `/api/datasets/${encodeURIComponent(params.datasetKey)}/keywords?${searchParams.toString()}`;
  const data = await request<{ success: boolean; data: { keywords: KeywordItem[]; total: number } }>(endpoint);
  return data.data;
}

export async function fetchExternalDatasets(): Promise<DatasetProfile[]> {
  const endpoint = '/api/datasets/external';
  const data = await request<DatasetProfile[]>(endpoint);
  return data;
}

export async function fetchDatasetsCompare(): Promise<any> {
  const endpoint = '/api/datasets/compare';
  const data = await request<any>(endpoint);
  return data;
}

// ==================== 心理档案 API ====================

// 前端静态演示档案数据（来自 demo_archives 表）
export interface DemoArchiveRecord {
  id: string;
  userId: string;
  dataSource: 'reddit';
  postCount: number;
  riskOverview: '高风险' | '中风险' | '低风险';
  importTime: string;
  lastActive?: string;
  status: 'importing' | 'ready' | 'analyzing';
  userStats?: {
    male: number;
    female: number;
    unknown: number;
  };
  hasTimestamp?: boolean;
  hasEmojis?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  riskValue?: number;
}

// 前端静态演示贴文数据（来自 demo_user_posts 表）
export interface DemoPostRecord {
  id: string;
  userId: string;
  postIndex: number;
  content: string;
  sentimentScore: number;
  importanceScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  suicideRisk?: number | string;
  timestamp?: string;
  hasTimestamp: boolean;
  hasEmojis?: boolean;
  emojiSequence?: string;  // 微表情序列（单个帖子对应一个 emoji 序列，如 "😔💪✨"）
  status: 'pending' | 'accepted' | 'rejected';
  isMissing?: boolean;
  isAnomaly?: boolean;
}

// 从 demo_archives 表获取演示档案列表
export async function fetchDemoArchives(params?: {
  page?: number;
  limit?: number;
  dataset?: string;
  riskLevel?: string;
}): Promise<{
  archives: DemoArchiveRecord[];
  stats: {
    total: number;
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    bySource: Record<string, number>;
  };
}> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.dataset) searchParams.set('dataset', params.dataset);
  if (params?.riskLevel) searchParams.set('risk_level', params.riskLevel);

  const endpoint = `/api/demo/archives?${searchParams.toString()}`;
  const data = await request<{
    archives: DemoArchiveRecord[];
    stats: {
      total: number;
      lowRisk: number;
      mediumRisk: number;
      highRisk: number;
      bySource: Record<string, number>;
    };
  }>(endpoint);
  return data;
}

// 从 demo_user_posts 表获取用户贴文列表
export async function fetchDemoUserPosts(userHash: string): Promise<{ posts: DemoPostRecord[] }> {
  const endpoint = `/api/demo/archives/${encodeURIComponent(userHash)}/posts`;
  const data = await request<{ posts: DemoPostRecord[] }>(endpoint);
  return data;
}

// 从用户贴文内容中提取高频词汇
export interface KeywordItem {
  word: string;
  count: number;
}

export async function fetchUserKeywords(userHash: string, topN = 8): Promise<{ keywords: KeywordItem[]; total: number }> {
  const endpoint = `/api/demo/archives/${encodeURIComponent(userHash)}/keywords?top_n=${topN}`;
  const data = await request<{ success: boolean; data: { keywords: KeywordItem[]; total: number } }>(endpoint);
  return data.data;
}

export interface PsychologicalArchive {
  id: number;
  userId: string;
  datasetSource: string;
  postCount: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskValue: number;
  label: number;
  hasTimestamp: boolean;
  postTimestampStart?: string;
  postTimestampEnd?: string;
  hasEmojis: boolean;
  importTimestamp: string;
  frequentWords?: string[];
  highImportanceCount: number;
  mediumImportanceCount: number;
  lowImportanceCount: number;
  avgImportanceScore?: number;
  status: 'importing' | 'ready' | 'analyzing';
  // 关联数据
  dataset?: DatasetProfile;
}

export interface ArchiveListResponse {
  archives: PsychologicalArchive[];
  stats: {
    total: number;
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    bySource: Record<string, number>;
  };
}

export async function fetchArchives(params?: {
  page?: number;
  limit?: number;
  dataset?: string;
  riskLevel?: string;
  keyword?: string;
}): Promise<ArchiveListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.dataset) searchParams.set('dataset', params.dataset);
  if (params?.riskLevel) searchParams.set('risk_level', params.riskLevel);
  if (params?.keyword) searchParams.set('keyword', params.keyword);

  const endpoint = `/api/users?${searchParams.toString()}`;
  const data = await request<ArchiveListResponse>(endpoint);
  return data;
}

export async function fetchArchiveDetail(userHash: string): Promise<{
  archive: PsychologicalArchive;
  posts: UserPost[];
}> {
  const endpoint = `/api/users/${userHash}`;
  const data = await request<{
    archive: PsychologicalArchive;
    posts: UserPost[];
  }>(endpoint);
  return data;
}

export interface UserPost {
  id: number;
  archiveId: number;
  userId: string;
  postIndex: number;
  content: string;
  sentimentScore?: number;
  importanceScore?: number;
  importanceLevel?: 'low' | 'medium' | 'high';
  microExpressions?: string[];
  postTimestamp?: string;
  emojiCount?: number;
  emojiSequence?: string;
  fineRiskValue?: number;
  reviewStatus: 'pending' | 'accepted' | 'rejected';
}

// ==================== 心理量表 API ====================

export interface ScaleTask {
  id: number;
  taskName: string;
  userId?: number;
  userHash: string;
  userAlias?: string;
  archiveId?: number;
  dataSource?: string;
  dataSourceLabel?: string;
  scaleId: number;
  scaleCode: string;
  scaleName: string;
  scaleFullName?: string;
  scaleCategory?: string;
  scaleColor?: string;
  scaleBgColor?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired';
  progress: number;
  totalQuestions: number;
  answeredQuestions: number;
  answers?: { qId: number; score: number }[];
  totalScore?: number;
  riskLevel?: string;
  assessmentResult?: string;
  startedAt?: string;
  completedAt?: string;
  expiredAt?: string;
  createdAt: string;
}

export interface ScaleTaskListResponse {
  tasks: ScaleTask[];
  stats: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
  };
}

export async function fetchScaleTasks(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<ScaleTaskListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);

  const endpoint = `/api/scale/tasks?${searchParams.toString()}`;
  const data = await request<ScaleTaskListResponse>(endpoint);
  return data;
}

/** 创建量表评估任务
 * @param task.scaleId 传入量表代码字符串（如 'PHQ-9'），后端接受字符串格式的 scale_code
 */
export async function createScaleTask(task: {
  userHash: string;
  archiveId?: number;
  scaleId: string | number;
  dataSource?: string;
}): Promise<ScaleTask> {
  const endpoint = '/api/scale/tasks';
  const data = await request<ScaleTask>(endpoint, {
    method: 'POST',
    body: JSON.stringify(task),
  });
  return data;
}

export async function submitScaleAnswers(
  taskId: number,
  answers: { qId: number; score: number }[]
): Promise<ScaleTask> {
  const endpoint = `/api/scale/tasks/${taskId}/submit`;
  const data = await request<ScaleTask>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
  return data;
}

export async function fetchScaleTaskResult(taskId: number): Promise<ScaleTask> {
  const endpoint = `/api/scale/tasks/${taskId}`;
  const data = await request<ScaleTask>(endpoint);
  return data;
}

export async function deleteScaleTask(taskId: number): Promise<void> {
  const endpoint = `/api/scale/tasks/${taskId}`;
  await request<void>(endpoint, { method: 'DELETE' });
}

// ==================== 检测任务类型 API ====================

export interface DetectionTaskType {
  id: number;
  typeCode: string;
  typeName: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  isActive: boolean;
}

export async function fetchDetectionTaskTypes(): Promise<DetectionTaskType[]> {
  const endpoint = '/api/risk/task-types';
  const data = await request<DetectionTaskType[]>(endpoint);
  return data;
}

// ==================== 风险检测 API ====================

export interface DetectionTask {
  id: number;
  taskCode?: string;
  taskName: string;
  taskDescription?: string;
  taskMode: 'single' | 'multi';
  taskTypeId: number;
  archiveId?: number;
  userHash: string;
  dataSource: string;
  postCount: number;
  // 单模型配置
  singleModelId?: number;
  singlePromptTemplateId?: number;
  // 多模型配置
  detectionModelConfigs?: any[];
  fusionModelId?: number;
  fusionPromptTemplateId?: number;
  // 状态
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  detectionProgress: number;
  fusionProgress: number;
  detectionStatus: 'pending' | 'running' | 'completed' | 'failed';
  fusionStatus: 'pending' | 'running' | 'completed' | 'failed';
  // 结果
  resultSummary?: any;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  processingTimeMs?: number;
  createdAt: string;
}

export interface DetectionTaskListResponse {
  tasks: DetectionTask[];
  stats: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export async function fetchDetectionTasks(params?: {
  page?: number;
  limit?: number;
  status?: string;
  dataSource?: string;
  taskType?: string;
}): Promise<DetectionTaskListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.dataSource) searchParams.set('data_source', params.dataSource);
  if (params?.taskType) searchParams.set('task_type', params.taskType);

  const endpoint = `/api/risk/tasks?${searchParams.toString()}`;
  // 后端返回 { success: true, data: { tasks: [...], stats: {...} } }
  // request 函数已返回 result.data，即 { tasks: [...], stats: {...} }
  const response = await request<{ success: boolean; data: DetectionTaskListResponse }>(endpoint);
  // response 已经是 { tasks: [...], stats: {...} }，无需再取 .data
  return response as unknown as DetectionTaskListResponse;
}

export async function createDetectionTask(task: {
  userHash: string;
  archiveId?: number;
  dataSource: string;
  taskTypeId: number;
  taskMode: 'single' | 'multi';
  singleModelId?: number;
  detectionModelConfigs?: any[];
  fusionModelId?: number;
  promptTemplateId?: number;
}): Promise<DetectionTask> {
  const endpoint = '/api/risk/tasks';
  const data = await request<DetectionTask>(endpoint, {
    method: 'POST',
    body: JSON.stringify(task),
  });
  return data;
}

export async function fetchDetectionResult(taskId: number): Promise<{
  task: DetectionTask;
  subTasks?: any[];
  fusionRecord?: any;
}> {
  const endpoint = `/api/risk/tasks/${taskId}`;
  const data = await request<{
    task: DetectionTask;
    subTasks?: any[];
    fusionRecord?: any;
  }>(endpoint);
  return data;
}

export async function fetchDetectionModelCompare(): Promise<any[]> {
  const endpoint = '/api/risk/compare';
  const data = await request<any[]>(endpoint);
  return data;
}

/**
 * 删除通用风险检测任务
 */
export async function deleteDetectionTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const endpoint = `/api/risk/tasks/${encodeURIComponent(taskId)}`;
  const data = await request<{ success: boolean; message?: string }>(endpoint, {
    method: 'DELETE',
  });
  return data;
}

/**
 * 删除 Emocc 检测任务
 */
export async function deleteEmoccTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const endpoint = `/api/risk/emocc-tasks/${encodeURIComponent(taskId)}`;
  const data = await request<{ success: boolean; message?: string }>(endpoint, {
    method: 'DELETE',
  });
  return data;
}

/**
 * 获取风险检测任务的完整诊断报告数据
 */
export async function fetchRiskReport(taskId: string): Promise<{
  taskId: number;
  taskCode: string;
  taskName: string;
  userHash: string;
  dataSource: string;
  postCount: number;
  modelName: string;
  processingTimeMs: number;
  createdAt: string;
  completedAt: string;
  resultSummary: {
    riskLevel: 'low' | 'medium' | 'high';
    riskScore: number;
    confidence: number;
    summary: string;
    emoccModelResult?: {
      riskLevel: string;
      riskScore: number;
      riskClass: number;
      confidence: number;
      postCount: number;
      classProbs: number[];
      postAttentionScores: { postIndex: number; attentionScore: number; textPreview: string }[];
      modelType: string;
    };
    symptomDescription?: string;
    emotionalAnalysis?: string;
    riskInterpretation?: string;
    keyHighlight?: string;
    riskFactors?: string[];
    protectiveFactors?: string[];
    professionalAdvice?: string;
    interventionSuggestion?: string;
    followUpSuggestion?: string;
  };
}> {
  const reportData = await request<any>(`/api/risk/tasks/${encodeURIComponent(taskId)}/report`);
  return reportData;
}

/**
 * 导出风险检测任务报告（HTML格式，新窗口打开打印/导出PDF）
 */
export function exportRiskReport(taskId: string): void {
  window.open(
    `${import.meta.env.VITE_API_BASE || ''}/api/risk/tasks/${encodeURIComponent(taskId)}/export-report`,
    '_blank'
  );
}

/**
 * 执行风险检测任务（根据任务类型调用不同模型）
 */
export async function executeDetectionTask(
  taskId: string
): Promise<{
  success: boolean;
  message?: string;
  taskId?: string;
  taskCode?: string;
  resultSummary?: any;
  processingTimeMs?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}> {
  const endpoint = `/api/risk/tasks/${encodeURIComponent(taskId)}/execute`;
  const data = await request<{
    success: boolean;
    message?: string;
    taskId?: string;
    taskCode?: string;
    resultSummary?: any;
    processingTimeMs?: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>(endpoint, { method: 'POST' });
  return data;
}

// ==================== 知识库 API ====================

export interface KnowledgeTopic {
  id: number;
  topicName: string;
  topicCode: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface KnowledgeSubTopic {
  id: number;
  topicId: number;
  subTopicName: string;
  subTopicCode: string;
  description?: string;
  sortOrder: number;
}

export interface KnowledgeDocument {
  id: number | string;
  title: string;
  topicId?: number | string;
  subTopicId?: number | string;
  keywords?: string[];
  format: 'pdf' | 'docx' | 'txt' | 'md';
  fileName: string;
  filePath: string;
  fileSize: number;
  sizeDisplay?: string;
  description?: string;
  fileType?: string;
  ragPath?: string;
  uploadStatus: 'uploading' | 'uploaded' | 'failed';
  progress?: number;
  isIndexed?: boolean;
  isDeleted?: boolean;
  usageCount?: number;
  uploadedBy?: string;
  uploadedAt?: string;
  createdAt: string;
  // 关联数据
  topic?: KnowledgeTopic;
  subTopic?: KnowledgeSubTopic;
  // 预览内容
  content?: string;
}

export async function fetchKnowledgeTopics(): Promise<{ topics: KnowledgeTopic[]; total: number }> {
  const endpoint = '/api/knowledge/topics';
  // 后端返回 { success, data: { topics: [...], total: N } }
  const data = await request<{ success: boolean; data: { topics: KnowledgeTopic[]; total: number } }>(endpoint);
  // 兼容处理：直接返回 data 对象或空对象
  return data?.data || { topics: [], total: 0 };
}

export async function fetchKnowledgeSubTopics(
  topicId?: number
): Promise<KnowledgeSubTopic[]> {
  let endpoint = '/api/knowledge/sub-topics';
  if (topicId) {
    endpoint += `?topic_id=${topicId}`;
  }
  const data = await request<KnowledgeSubTopic[]>(endpoint);
  return data;
}

export interface DocumentListResponse {
  documents: KnowledgeDocument[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function fetchKnowledgeDocuments(params?: {
  page?: number;
  limit?: number;
  pageSize?: number;
  topicId?: number;
  subTopicId?: number;
  keyword?: string;
  format?: string;
  status?: string;
}): Promise<DocumentListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('page_size', String(params.pageSize));
  else if (params?.limit) searchParams.set('page_size', String(params.limit));
  if (params?.topicId) searchParams.set('topic_id', String(params.topicId));
  if (params?.subTopicId) searchParams.set('sub_topic_id', String(params.subTopicId));
  if (params?.keyword) searchParams.set('keyword', params.keyword);
  if (params?.format) searchParams.set('format', params.format);
  if (params?.status) searchParams.set('status', params.status);

  const endpoint = `/api/knowledge/documents?${searchParams.toString()}`;
  const data = await request<DocumentListResponse>(endpoint);
  return data;
}

// 获取单个文档详情
export async function fetchKnowledgeDocument(documentId: number | string): Promise<KnowledgeDocument> {
  const endpoint = `/api/knowledge/documents/${documentId}`;
  const data = await request<KnowledgeDocument>(endpoint);
  return data;
}

// 上传知识库文档
export async function uploadKnowledgeDocument(
  formData: FormData
): Promise<{ success: boolean; document?: KnowledgeDocument; message?: string }> {
  const response = await fetch(`${API_BASE}/api/upload/knowledge`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: '上传失败' }));
    throw new Error(errorData.message || `上传失败: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || '上传失败');
  }
  return result;
}

// 获取文档预览内容（纯文本/Markdown）
export async function fetchDocumentPreview(
  documentId: number | string
): Promise<{ content: string; format: string }> {
  const endpoint = `/api/knowledge/documents/${documentId}/preview`;
  const data = await request<{ content: string; format: string }>(endpoint);
  return data;
}

// 删除知识库文档
export async function deleteKnowledgeDocument(documentId: number | string): Promise<{ success: boolean; message?: string }> {
  const endpoint = `/api/knowledge/documents/${documentId}`;
  const data = await request<{ success: boolean; message?: string }>(endpoint, { method: 'DELETE' });
  return data;
}

// 下载知识库文档
export function downloadKnowledgeDocument(documentId: number | string, fileName?: string): void {
  const endpoint = `${API_BASE}/api/knowledge/documents/${documentId}/download`;
  const link = document.createElement('a');
  link.href = endpoint;
  if (fileName) link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 更新知识库文档
export async function updateKnowledgeDocument(
  docId: number,
  data: {
    title?: string;
    topic_id?: number | string;
    sub_topic_id?: number | string;
    keywords?: string;
    summary?: string;
  }
): Promise<{ success: boolean; document?: KnowledgeDocument; message?: string }> {
  const endpoint = `/api/knowledge/documents/${docId}`;
  const result = await request<{ success: boolean; document?: KnowledgeDocument; message?: string }>(
    endpoint,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
  return result;
}

// 创建知识库文档（无文件）
export async function createKnowledgeDocument(
  data: {
    title: string;
    topic_id: number | string;
    sub_topic_id?: number | string;
    keywords?: string;
    summary?: string;
    file_path?: string;
    file_name?: string;
    file_size?: number;
    format?: string;
  }
): Promise<{ success: boolean; document?: KnowledgeDocument; message?: string }> {
  const endpoint = '/api/knowledge/documents';
  const result = await request<{ success: boolean; document?: KnowledgeDocument; message?: string }>(
    endpoint,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
  return result;
}

// ==================== 智能问答 API ====================

export interface ChatSession {
  id: number;
  sessionCode?: string;
  userId?: number;
  userHash?: string;
  archiveId?: number;
  dataSource?: string;
  aiMode: 'deep_think' | 'risk_assessment' | 'intervention' | 'scale_interpret';
  contextType: 'general' | 'knowledge_base' | 'archive' | 'scale';
  knowledgeSources?: string[];
  ragKeywords?: string[];
  messageCount: number;
  totalTokens: number;
  status: 'active' | 'archived' | 'deleted';
  isPinned: boolean;
  lastMessageAt?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number | string;
  sessionId: number | string;
  role: 'user' | 'ai' | 'system';
  content: string;
  contentType?: 'text' | 'html' | 'markdown';
  attachments?: any[];
  hasImage?: boolean;
  hasFile?: boolean;
  aiModel?: string;
  aiMode?: string;
  tokensUsed?: number;
  processingTimeMs?: number;
  ragContext?: any;
  rag_context?: any;  // snake_case 兼容
  retrievalSources?: any[];
  retrieval_sources?: any[];  // snake_case 兼容
  isGenerating?: boolean;
  isStreaming?: boolean;
  isError?: boolean;
  errorMessage?: string;
  references?: any;
  referencesJson?: any;
  parentMessageId?: number;
  createdAt: string;
}

// ============================================================
// 聊天附件上传 API
// ============================================================

export interface UploadResponse {
  id: string;
  filename: string;
  saved_name: string;
  url: string;
  file_type: string;
  size: number;
  content_type?: string;
}

/**
 * 上传单个附件到 backend/uploads 目录
 */
export async function uploadAttachment(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/chat/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `上传失败: HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

/**
 * 批量上传多个附件
 */
export async function uploadAttachments(files: File[]): Promise<{
  uploaded: UploadResponse[];
  failed: { filename: string; error: string }[];
}> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch('/api/chat/upload-multiple', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`批量上传失败: HTTP ${response.status}`);
  }

  return (await response.json()).data;
}

export async function fetchChatSessions(params?: {
  page?: number;
  limit?: number;
}): Promise<{ sessions: ChatSession[]; pagination: any }> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('page_size', String(params.limit));

  const endpoint = `/api/chat/sessions?${searchParams.toString()}`;
  const data = await request<{
    sessions: ChatSession[];
    total: number;
    page: number;
    page_size: number;
  }>(endpoint);
  return {
    sessions: data?.sessions || [],
    pagination: {
      total: data?.total || 0,
      page: data?.page || 1,
      pageSize: data?.page_size || params?.limit || 20,
    }
  };
}

export async function createChatSession(session: {
  userHash?: string;
  archiveId?: number;
  dataSource?: string;
  aiMode: string;
  contextType?: string;
}): Promise<ChatSession> {
  const endpoint = '/api/chat/sessions';
  // request 函数已经自动解包 {success, data} -> data，所以这里直接用 ChatSession
  const data = await request<ChatSession>(endpoint, {
    method: 'POST',
    body: JSON.stringify(session),
  });
  return data;
}

export async function deleteChatSession(sessionId: number): Promise<void> {
  const endpoint = `/api/chat/sessions/${sessionId}`;
  await request<void>(endpoint, { method: 'DELETE' });
}

export async function fetchChatMessages(
  sessionId: number
): Promise<ChatMessage[]> {
  const endpoint = `/api/chat/sessions/${sessionId}/messages`;
  const data = await request<ChatMessage[]>(endpoint);
  return Array.isArray(data) ? data : [];
}

export async function sendChatMessage(
  sessionId: number,
  content: string,
  attachments?: any[],
  aiMode?: string
): Promise<ChatMessage> {
  const endpoint = `/api/chat/sessions/${sessionId}/messages`;
  const data = await request<ChatMessage>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ content, attachments, aiMode }),
  });
  return data;
}

// 附件类型（用于聊天上传）
export interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  content?: string;
  saved_name?: string;
}

// 文档来源类型（用于 RAG 检索）
export interface DocSource {
  id: string;
  title: string;
  type: 'pdf' | 'word' | 'md' | 'txt';
  topic?: string;
  subTopic?: string;
}

export async function sendChatMessageStream(
  sessionId: number,
  content: string,
  aiMode?: string,
  attachments?: Attachment[] | undefined,
  onChunk?: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
  onRagSources?: (sources: DocSource[]) => void,
  onMindMap?: (mindMap: any) => void,
  onRagEvidence?: (evidence: any[]) => void,
  onPreKnowledge?: (terms: any) => void,
  onContextSources?: (sources: string[]) => void
): Promise<void> {
  const endpoint = `/api/chat/sessions/${sessionId}/messages/stream`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ content, aiMode, attachments }),
  });

  if (!resp.ok) {
    onError?.(new Error(`HTTP ${resp.status}`));
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    onError?.(new Error('浏览器不支持流式读取'));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  // 流式渲染缓冲：合并 SSE 数据包，平滑更新 DOM
  // 累积 chunk，每 60ms 更新一次 DOM，避免逐字渲染导致的"卡顿感"
  let pendingContent = '';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const BATCH_INTERVAL_MS = 60; // 每 60ms 批量更新一次

  const flushPendingContent = () => {
    if (pendingContent.length > 0) {
      onChunk?.(pendingContent);
      pendingContent = '';
    }
    pendingTimer = null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const text = line.trim();
      if (!text.startsWith('data: ')) continue;
      try {
        const json = JSON.parse(text.slice(6));
        if (json.type === 'chunk') {
          // 累积内容，用定时器批量更新
          pendingContent += json.content;
          if (!pendingTimer) {
            pendingTimer = setTimeout(flushPendingContent, BATCH_INTERVAL_MS);
          }
        } else if (json.type === 'done') {
          // 流结束，刷新剩余内容
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          flushPendingContent();
          onDone?.();
        } else if (json.type === 'error') {
          // 流结束，刷新剩余内容
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          flushPendingContent();
          onError?.(new Error(json.message));
        } else if (json.type === 'rag_sources' && Array.isArray(json.sources)) {
          // 解析 RAG 检索来源（使用 Array.isArray 以支持空数组）
          const sources: DocSource[] = (json.sources as any[]).map((s: any) => ({
            id: String(s.id || s.title),
            title: s.title,
            type: (s.type as 'pdf' | 'word' | 'md' | 'txt') || 'md',
            topic: s.topic || '',
            subTopic: s.subTopic || '',
          }));
          onRagSources?.(sources);
        } else if (json.type === 'mind_map' && json.mindMap) {
          onMindMap?.(json.mindMap);
        } else if (json.type === 'rag_evidence' && Array.isArray(json.evidence)) {
          onRagEvidence?.(json.evidence as any[]);
        } else if (json.type === 'pre_knowledge') {
          onPreKnowledge?.(json.terms);
        } else if (json.type === 'context_sources' && Array.isArray(json.sources)) {
          // 解析上下文数据来源（使用 Array.isArray 以支持空数组）
          onContextSources?.(json.sources as string[]);
        }
      } catch {}
    }
  }

  // 确保流结束时刷新剩余内容
  if (pendingContent.length > 0) {
    flushPendingContent();
  }
}

export async function fetchRecommendedQuestions(
  aiMode?: string
): Promise<{ question: string; aiMode: string }[]> {
  const searchParams = new URLSearchParams();
  if (aiMode) searchParams.set('ai_mode', aiMode);

  const endpoint = `/api/chat/recommended-questions?${searchParams.toString()}`;
  const data = await request<{ success: boolean; data: { id: number; question: string; category: string; aiMode?: string }[] }>(endpoint);
  // 返回 data 数组，兼容旧格式，添加 aiMode 字段
  const questions = Array.isArray(data) ? data : (data?.data || []);
  return questions.map((q: any) => ({
    question: q.question,
    aiMode: q.aiMode || q.category || 'general'
  }));
}

// ==================== 模型中心 API ====================

export interface Model {
  id: number;
  modelName: string;
  modelCode: string;
  modelCategory: 'api' | 'local_llm' | 'detection';
  modelType: 'api' | 'ollama' | 'transformers' | 'fealearner' | 'emoji';
  // API模型
  provider?: string;
  apiBaseUrl?: string;
  configTemplate?: string;
  // 本地LLM
  ollamaModelName?: string;
  ollamaBaseUrl?: string;
  modelPath?: string;
  loraPath?: string;
  // 检测模型
  detectionType?: 'emoji';
  modelFilePath?: string;
  embeddingFilePath?: string;
  supportedDatasets?: string[];
  // 通用
  description?: string;
  version?: string;
  isAvailable: boolean;
  isDefault?: boolean;
  isBuiltin?: boolean;
  performanceMetrics?: any;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  lastUsedAt?: string;
  usageCount: number;
  avgProcessingTimeMs?: number;
  createdAt: string;
}

export interface PromptTemplate {
  id: number;
  name: string;
  taskType: string;
  description?: string;
  promptContent: string;
  variables?: any;
  modelId?: number;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
}

export async function fetchModels(params?: {
  category?: string;
  type?: string;
}): Promise<Model[]> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.type) searchParams.set('type', params.type);

  const endpoint = `/api/models?${searchParams.toString()}`;
  const data = await request<Model[]>(endpoint);
  return data;
}

export async function fetchPromptTemplates(params?: {
  taskType?: string;
}): Promise<PromptTemplate[]> {
  const searchParams = new URLSearchParams();
  if (params?.taskType) searchParams.set('task_type', params.taskType);

  const endpoint = `/api/models/templates?${searchParams.toString()}`;
  const data = await request<PromptTemplate[]>(endpoint);
  return data;
}

export async function fetchPromptTemplateDetail(templateId: number): Promise<PromptTemplate> {
  return request<PromptTemplate>(`/api/models/templates/${templateId}`);
}

export async function createPromptTemplate(
  template: Pick<PromptTemplate, 'name' | 'taskType' | 'promptContent'> & Partial<PromptTemplate>
): Promise<PromptTemplate> {
  return request<PromptTemplate>('/api/models/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function updatePromptTemplate(
  templateId: number,
  template: Partial<PromptTemplate>
): Promise<PromptTemplate> {
  return request<PromptTemplate>(`/api/models/templates/${templateId}`, {
    method: 'PUT',
    body: JSON.stringify(template),
  });
}

export async function deletePromptTemplate(templateId: number): Promise<void> {
  await request(`/api/models/templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function createModel(model: Partial<Model>): Promise<Model> {
  const endpoint = '/api/models';
  const data = await request<Model>(endpoint, {
    method: 'POST',
    body: JSON.stringify(model),
  });
  return data;
}

export async function updateModel(
  modelId: number,
  model: Partial<Model>
): Promise<Model> {
  const endpoint = `/api/models/${modelId}`;
  const data = await request<Model>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(model),
  });
  return data;
}

export async function deleteModel(modelId: number): Promise<void> {
  const endpoint = `/api/models/${modelId}`;
  await request<void>(endpoint, { method: 'DELETE' });
}

// 配置 API Key（适用于预置 API 模型模板）
export async function updateModelApiKey(
  modelId: number,
  apiKey: string,
): Promise<any> {
  const endpoint = `/api/models/${modelId}/api-key`;
  return request(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ api_key: apiKey }),
  });
}

// ==================== 心理援助地图 API ====================

export interface InstitutionListResponse {
  institutions: Institution[];
  stats?: InstitutionStats;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function fetchInstitutions(params?: {
  page?: number;
  limit?: number;
  city?: string;
  type?: string;
}): Promise<InstitutionListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.city) searchParams.set('city', params.city);
  if (params?.type) searchParams.set('type', params.type);

  const endpoint = `/api/institutions?${searchParams.toString()}`;
  const data = await request<InstitutionListResponse>(endpoint);
  return data;
}

export async function fetchNearbyInstitutions(params: {
  lat: number;
  lng: number;
  radius?: number;
}): Promise<Institution[]> {
  const searchParams = new URLSearchParams();
  searchParams.set('latitude', String(params.lat));
  searchParams.set('longitude', String(params.lng));
  if (params.radius) searchParams.set('radius_km', String(params.radius));

  const endpoint = `/api/institutions/nearby?${searchParams.toString()}`;
  const data = await request<Institution[]>(endpoint);
  return data;
}

export async function fetchInstitutionDetail(
  institutionId: number
): Promise<Institution> {
  const endpoint = `/api/institutions/${institutionId}`;
  const data = await request<Institution>(endpoint);
  return data;
}

export async function fetchHotlines(params?: {
  province?: string;
  city?: string;
}): Promise<HotLine[]> {
  const searchParams = new URLSearchParams();
  if (params?.province) searchParams.set('province', params.province);
  if (params?.city) searchParams.set('city', params.city);

  const endpoint = `/api/hotlines?${searchParams.toString()}`;
  const data = await request<HotLine[]>(endpoint);
  return data;
}

export async function fetchNationalHotlines(): Promise<HotLine[]> {
  const endpoint = '/api/hotlines/national';
  const data = await request<HotLine[]>(endpoint);
  return data;
}

export async function fetchLocalHotlines(city: string): Promise<HotLine[]> {
  const endpoint = `/api/hotlines/local?city=${encodeURIComponent(city)}`;
  const data = await request<HotLine[]>(endpoint);
  return data;
}

export async function fetchCities(): Promise<CityInfo[]> {
  const endpoint = '/api/cities';
  const data = await request<CityInfo[]>(endpoint);
  return data;
}

export async function fetchCityCoordinates(): Promise<Record<string, [number, number]>> {
  const endpoint = '/api/cities/coordinates';
  const data = await request<Record<string, [number, number]>>(endpoint);
  return data;
}

export async function fetchInstitutionStats(): Promise<InstitutionStats> {
  const endpoint = '/api/institutions/statistics';
  const data = await request<InstitutionStats>(endpoint);
  return data;
}

export async function fetchInstitutionTypes(): Promise<string[]> {
  const endpoint = '/api/institution-types';
  const data = await request<string[]>(endpoint);
  return data;
}

export async function fetchHotlineStats(): Promise<HotLineStats> {
  const endpoint = '/api/hotlines/statistics';
  const data = await request<HotLineStats>(endpoint);
  return data;
}

// ==================== 健康检查 ====================

export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  const endpoint = '/api/health';
  const data = await request<{ status: string; timestamp: string }>(endpoint);
  return data;
}

// ==================== 系统配置 API ====================

export interface KnowledgeKeyword {
  id: number;
  keyword: string;
  category?: string;
  colorClass?: string;
  isHot: boolean;
  usageCount?: number;
  sortOrder?: number;
  isActive?: boolean;
}

/** 获取知识库关键词列表 */
export async function fetchKnowledgeKeywords(isHot?: boolean): Promise<KnowledgeKeyword[]> {
  const searchParams = new URLSearchParams();
  if (isHot !== undefined) searchParams.set('is_hot', String(isHot));

  const endpoint = `/api/knowledge/keywords${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  try {
    const data = await request<KnowledgeKeyword[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取知识库关键词失败:', error);
    return [];
  }
}

// ==================== Ollama 本地模型 API ====================

export interface OllamaInstalledModel {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
  digest?: string;
}

export interface OllamaStatus {
  success: boolean;
  available: boolean;
  base_url: string;
  models: OllamaInstalledModel[];
  error?: string;
}

export interface OllamaTestResult {
  model_id: number;
  model_name: string;
  model_type: string;
  response?: string;
  error?: string;
}

export interface ModelInferenceResult {
  model_id: number;
  model_name: string;
  model_type: string;
  response?: string;
  error?: string;
}

/**
 * 获取 Ollama 服务健康状态
 */
export async function fetchOllamaStatus(
  baseUrl?: string
): Promise<OllamaStatus> {
  const endpoint = `/api/models/ollama/status${baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : ''}`;
  try {
    const data = await request<OllamaStatus>(endpoint);
    return data;
  } catch (error) {
    console.error('获取 Ollama 状态失败:', error);
    return {
      success: false,
      available: false,
      base_url: baseUrl || 'http://localhost:11434',
      models: [],
      error: String(error)
    };
  }
}

/**
 * 获取 Ollama 服务上已安装的模型列表
 */
export async function fetchOllamaInstalledModels(
  baseUrl?: string
): Promise<{ models: OllamaInstalledModel[]; base_url: string }> {
  const endpoint = `/api/models/ollama/models${baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : ''}`;
  try {
    const data = await request<{ models: OllamaInstalledModel[]; base_url: string }>(endpoint);
    return data;
  } catch (error) {
    console.error('获取 Ollama 已安装模型失败:', error);
    return {
      models: [],
      base_url: baseUrl || 'http://localhost:11434'
    };
  }
}

/**
 * 获取系统中已配置的 Ollama 模型
 */
export async function fetchConfiguredOllamaModels(): Promise<Array<{
  id: number;
  modelName: string;
  modelCode: string;
  ollamaModelName: string;
  ollamaBaseUrl: string;
  description?: string;
  status: string;
  usageCount: number;
}>> {
  const endpoint = '/api/models/ollama/configured';
  try {
    const data = await request<any[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取已配置 Ollama 模型失败:', error);
    return [];
  }
}

/**
 * 测试模型连接
 */
export async function testModelConnection(
  modelId: number,
  testPrompt?: string
): Promise<OllamaTestResult> {
  const endpoint = `/api/models/${modelId}/test`;
  try {
    const data = await request<OllamaTestResult>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ prompt: testPrompt || '请只回复：OK' }),
    });
    return data;
  } catch (error) {
    console.error('测试模型连接失败:', error);
    return {
      model_id: modelId,
      model_name: '',
      model_type: 'unknown',
      error: String(error)
    };
  }
}

/**
 * 调用模型进行推理
 */
export async function callModelInference(
  modelId: number,
  prompt: string,
  systemPrompt?: string
): Promise<ModelInferenceResult> {
  const endpoint = `/api/models/${modelId}/call`;
  try {
    const data = await request<ModelInferenceResult>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ prompt, system_prompt: systemPrompt }),
    });
    return data;
  } catch (error) {
    console.error('模型推理失败:', error);
    return {
      model_id: modelId,
      model_name: '',
      model_type: 'unknown',
      error: String(error)
    };
  }
}

// ==================== 模型提供商 API ====================

export interface ModelProvider {
  key: string;
  name: string;
  nameZh: string;
  baseUrl: string;
  models: string[];
  description: string;
}

export interface ApiModel {
  id: number;
  modelName: string;
  modelCode: string;
  provider: string;
  apiBaseUrl: string;
  description?: string;
  status: string;
  usageCount: number;
}

/**
 * 获取支持的模型提供商列表
 */
export async function fetchModelProviders(): Promise<ModelProvider[]> {
  const endpoint = '/api/models/providers';
  try {
    const data = await request<ModelProvider[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取模型提供商失败:', error);
    return [];
  }
}

/**
 * 获取系统中已配置的 API 模型
 */
export async function fetchConfiguredApiModels(): Promise<ApiModel[]> {
  const endpoint = '/api/models/api/configured';
  try {
    const data = await request<ApiModel[]>(endpoint);
    return data;
  } catch (error) {
    console.error('获取已配置 API 模型失败:', error);
    return [];
  }
}

// ==================== 模型适配器（RiskPage 专用）====================
// 将 API 的 Model 类型适配为 RiskPage 所需的格式

export interface RiskPageApiModel {
  id: string;
  name: string;
  provider: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface RiskPagePromptTemplate {
  id: string;
  name: string;
  taskType: string;
  description: string;
  content?: string;
  createdAt: string;
}

export interface RiskPageLocalModel {
  id: string;
  name: string;
  type: 'llm' | 'emoji' | 'fealearner';
  path: string;
  status: 'active' | 'inactive';
  createdAt: string;
  provider?: string;
}

export interface RiskPageLlmModel {
  id: string;
  name: string;
  provider: string;
  type: 'llm' | 'api';
  path?: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

/** 获取 API 模型（适配后） */
export async function fetchApiModelsForRiskPage(): Promise<RiskPageApiModel[]> {
  try {
    const models = await fetchConfiguredApiModels();
    return models.map(m => ({
      id: String(m.id),
      name: m.modelName,
      provider: m.provider,
      status: (m.status === 'active' || m.status === 'enabled') ? 'active' as const : 'inactive' as const,
      createdAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/** 获取提示词模板（适配后） */
export async function fetchPromptTemplatesForRiskPage(): Promise<RiskPagePromptTemplate[]> {
  try {
    const templates = await fetchPromptTemplates();
    return templates.map(t => ({
      id: String(t.id),
      name: t.name,
      taskType: t.taskType,
      description: t.description || '',
      content: t.promptContent,
      createdAt: t.createdAt,
    }));
  } catch {
    return [];
  }
}

/** 获取检测模型（detection 类型，适配后） */
export async function fetchDetectionModelsForRiskPage(): Promise<RiskPageLocalModel[]> {
  try {
    const models = await fetchModels({ category: 'detection' });
    return models.map(m => ({
      id: String(m.id),
      name: m.modelName,
      // 根据 modelType 动态设置 type：emoji -> emoji, fealearner -> fealearner, 其他 -> llm
      type: (m.modelType === 'emoji' ? 'emoji' : m.modelType === 'fealearner' ? 'fealearner' : 'llm') as 'emoji' | 'fealearner' | 'llm',
      // 优先使用 modelFilePath，其次是 modelCode
      path: m.modelFilePath || m.modelPath || m.modelCode || '',
      status: m.status === 'active' ? 'active' as const : 'inactive' as const,
      createdAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/** 获取所有本地 LLM 模型（仅 Ollama，适配后） */
export async function fetchLlmModelsForRiskPage(): Promise<RiskPageLlmModel[]> {
  try {
    // model_category='local_llm' 对应 Ollama 本地模型
    const localModels = await fetchModels({ category: 'local_llm' });
    const result: RiskPageLlmModel[] = localModels.map(m => ({
      id: String(m.id),
      name: m.modelName,
      provider: m.ollamaModelName || m.modelCode || m.modelName,
      type: 'llm' as const,
      path: m.modelPath || m.ollamaModelName || '',
      status: (m.status === 'active') ? 'active' as const : 'inactive' as const,
      createdAt: new Date().toISOString(),
    }));
    return result;
  } catch {
    return [];
  }
}

// ==================== Emocc 本地模型检测 API ====================

export interface EmoccPostAttention {
  postIndex: number;
  attentionScore: number;
  textPreview: string;
  emojiCount: number;
}

export interface EmoccResult {
  risk_level: 'high' | 'medium' | 'low';
  risk_score: number;
  risk_class: number;
  confidence: number;
  post_attention_scores: EmoccPostAttention[];
  class_probs: number[];
  post_count: number;
  model_type: string;
}

export interface EmoccFusionResult {
  fused_risk_level: string;
  fused_risk_score: number;
  confidence: number;
  summary: string;
  key_highlight?: string;
  risk_factors: string[];
  protective_factors: string[];
  professional_advice: string;
  follow_up_suggestion?: string;
  fusion_method: string;
  llm_response?: string;
  model?: string;
}

export interface EmoccTaskResult {
  id: number;
  taskCode: string;
  taskName: string;
  taskDescription: string;
  taskMode: string;
  userHash: string;
  dataSource: string;
  postCount: number;
  modelName?: string;
  progress: number;
  status: string;
  resultSummary?: {
    riskLevel: string;
    riskScore: number;
    confidence: number;
    summary: string;
    emoccModelResult?: {
      riskLevel: string;
      riskScore: number;
      riskClass: number;
      confidence: number;
      postCount: number;
      classProbs: number[];
      postAttentionScores?: { postIndex: number; attentionScore: number; textPreview: string }[];
      modelType: string;
    };
    fusionMethod: string;
    symptomDescription?: string;
    emotionalAnalysis?: string;
    riskInterpretation?: string;
    keyHighlight?: string;
    riskFactors?: string[];
    protectiveFactors?: string[];
    professionalAdvice?: string;
    interventionSuggestion?: string;
    followUpSuggestion?: string;
    llmModel?: string;
  };
  emoccResult?: EmoccResult;
  fusionResult?: EmoccFusionResult;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  processingTimeMs: number;
}

/**
 * 创建Emocc本地模型检测任务
 */
export async function createEmoccDetectionTask(params: {
  userHash: string;
  dataSource?: string;
  useLlmFusion?: boolean;
  temperature?: number;
  maxTokens?: number;
  fusionModelId?: number; // 用于融合的 LLM 模型 ID
  taskName?: string; // 用户输入的任务名称，没输入则后端自动生成
}): Promise<EmoccTaskResult> {
  const endpoint = '/api/risk/emocc-tasks';
  const body: Record<string, any> = {
    userHash: params.userHash,
    dataSource: params.dataSource || 'reddit',
    useLlmFusion: params.useLlmFusion ?? true,
    temperature: params.temperature ?? 0.7,
    maxTokens: params.maxTokens ?? 2048,
  };
  
  // 如果指定了 fusionModelId，添加到请求体
  if (params.fusionModelId) {
    body.fusionModelId = params.fusionModelId;
  }
  
  // 如果用户提供了 taskName，添加到请求体
  if (params.taskName) {
    body.taskName = params.taskName;
  }
  
  const data = await request<EmoccTaskResult>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data;
}

/**
 * 获取Emocc检测任务列表
 */
export async function fetchEmoccTasks(params?: {
  page?: number;
  limit?: number;
}): Promise<{
  tasks: EmoccTaskResult[];
  total: number;
  page: number;
  limit: number;
}> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const endpoint = `/api/risk/emocc-tasks?${searchParams.toString()}`;
  // 后端返回 { success: true, data: { tasks: [...], total, page, limit } }
  // request 函数已返回 result.data，即 { tasks: [...], total, page, limit }
  const data = await request<{
    success: boolean;
    data: { tasks: EmoccTaskResult[]; total: number; page: number; limit: number };
  }>(endpoint);
  // data 已经是 { tasks: [...], total, page, limit }，无需再取 .data
  return data as unknown as {
    tasks: EmoccTaskResult[];
    total: number;
    page: number;
    limit: number;
  };
}

/**
 * 获取Emocc检测任务详情
 */
export async function fetchEmoccTaskDetail(taskId: string): Promise<EmoccTaskResult> {
  const endpoint = `/api/risk/emocc-tasks/${encodeURIComponent(taskId)}`;
  // 后端返回 { success: true, data: { id, taskCode, ... } }
  // request 函数已返回 result.data，即 { id, taskCode, ... }
  const data = await request<{ success: boolean; data: EmoccTaskResult }>(endpoint);
  // data 已经是 { id, taskCode, ... }，无需再取 .data
  return data as unknown as EmoccTaskResult;
}

/**
 * 执行Emocc检测任务
 */
export async function executeEmoccTask(taskId: number): Promise<{
  success: boolean;
  id: number;
  taskCode: string;
  taskName: string;
  userHash: string;
  dataSource: string;
  postCount: number;
  progress: number;
  status: string;
  resultSummary?: any;
  processingTimeMs?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}> {
  const endpoint = `/api/risk/emocc-tasks/${taskId}/execute`;
  return request(endpoint, { method: 'POST' });
}

/**
 * 获取Emocc模型信息
 */
export async function fetchEmoccModelInfo(): Promise<{
  model_name: string;
  model_type: string;
  description: string;
  architecture: Record<string, string>;
  features: string[];
  performance: Record<string, number>;
  supported_datasets: string[];
  input_format: Record<string, string>;
  output_format: Record<string, string>;
}> {
  const endpoint = '/api/risk/emocc-models';
  const data = await request<{
    success: boolean;
    data: {
      model_name: string;
      model_type: string;
      description: string;
      architecture: Record<string, string>;
      features: string[];
      performance: Record<string, number>;
      supported_datasets: string[];
      input_format: Record<string, string>;
      output_format: Record<string, string>;
    };
  }>(endpoint);
  return data.data;
}

// ==================== 档案导入 API ====================

export interface UploadArchiveResult {
  success: boolean;
  datasetKey: string;
  fileName: string;
  savedName: string;
  filePath: string;
  totalUsers: number;
  totalPosts: number;
  riskDistribution: Record<string, number>;
  columns: string[];
  preview: Array<{
    userId: string;
    postCount: number;
    riskLabel: string;
    riskValue: number;
    firstPost: string;
  }>;
  uploadedAt: string;
}

/**
 * 上传心理档案 CSV 文件
 */
export async function uploadArchiveCSV(file: File, dataSource: string = 'reddit'): Promise<UploadArchiveResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('data_source', dataSource);

  const response = await fetch('/api/upload/archive', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: '上传失败' }));
    throw new Error(err.detail || `上传失败: HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || '上传失败');
  }
  return result.data;
}

/**
 * 确认导入档案
 */
export async function confirmArchiveImport(params: {
  datasetKey: string;
  filePath: string;
  dataSource?: string;
  acceptedRecords?: string[];
  isManualAnnotation?: boolean;
}): Promise<{ success: boolean; message: string; totalUsers: number; totalPosts: number }> {
  const response = await fetch('/api/upload/archive/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: '确认导入失败' }));
    throw new Error(err.detail || `确认导入失败: HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

/**
 * 获取已上传的数据集列表
 */
export async function fetchUploadedDatasets(): Promise<Array<{
  fileName: string;
  filePath: string;
  fileSize: number;
  totalUsers?: number;
  totalPosts?: number;
  riskDistribution?: Record<string, number>;
  error?: string;
}>> {
  const response = await fetch('/api/upload/archive/datasets');
  if (!response.ok) {
    throw new Error(`获取上传数据集失败: HTTP ${response.status}`);
  }
  const result = await response.json();
  return result.data || [];
}

/**
 * 删除已上传的数据集
 */
export async function deleteUploadedDataset(filename: string): Promise<void> {
  const response = await fetch(`/api/upload/archive/datasets/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`删除失败: HTTP ${response.status}`);
  }
}

// ==================== 导出所有 API 函数 ====================

export const api = {
  // 首页
  fetchHomeStats,
  fetchHomeTrend,
  fetchHomeCards,

  // 数据集
  fetchDatasets,
  fetchDatasetCSVInfo,
  fetchCSVArchives,
  fetchCSVPUserPosts,
  fetchCSVUserKeywords,
  fetchExternalDatasets,
  fetchDatasetsCompare,

  // 心理档案
  fetchArchives,
  fetchArchiveDetail,
  fetchDemoArchives,
  fetchDemoUserPosts,
  fetchUserKeywords,

  // 心理量表
  fetchScaleTasks,
  createScaleTask,
  submitScaleAnswers,
  fetchScaleTaskResult,
  deleteScaleTask,

  // 风险检测
  fetchDetectionTaskTypes,
  fetchDetectionTasks,
  createDetectionTask,
  deleteDetectionTask,
  deleteEmoccTask,
  executeDetectionTask,
  fetchDetectionResult,
  fetchDetectionModelCompare,

  // 报告相关
  fetchRiskReport,
  exportRiskReport,

  // 知识库
  fetchKnowledgeTopics,
  fetchKnowledgeSubTopics,
  fetchKnowledgeDocuments,
  fetchKnowledgeDocument,
  uploadKnowledgeDocument,
  fetchDocumentPreview,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  updateKnowledgeDocument,
  createKnowledgeDocument,

  // 智能问答
  fetchChatSessions,
  createChatSession,
  deleteChatSession,
  fetchChatMessages,
  sendChatMessage,
  sendChatMessageStream,
  uploadAttachment,
  uploadAttachments,
  fetchRecommendedQuestions,

  // 模型中心
  fetchModels,
  fetchPromptTemplates,
  fetchPromptTemplateDetail,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  createModel,
  updateModel,
  deleteModel,
  updateModelApiKey,

  // Ollama 本地模型
  fetchOllamaStatus,
  fetchOllamaInstalledModels,
  fetchConfiguredOllamaModels,
  testModelConnection,
  callModelInference,

  // 模型提供商
  fetchModelProviders,
  fetchConfiguredApiModels,

  // 模型适配器（RiskPage 专用）
  fetchApiModelsForRiskPage,
  fetchPromptTemplatesForRiskPage,
  fetchDetectionModelsForRiskPage,
  fetchLlmModelsForRiskPage,

  // 心理援助地图
  fetchInstitutions,
  fetchNearbyInstitutions,
  fetchInstitutionDetail,
  fetchHotlines,
  fetchNationalHotlines,
  fetchLocalHotlines,
  fetchCities,
  fetchCityCoordinates,
  fetchInstitutionTypes,
  fetchInstitutionStats,
  fetchHotlineStats,

  // Emocc 本地模型检测
  createEmoccDetectionTask,
  fetchEmoccTasks,
  fetchEmoccTaskDetail,
  executeEmoccTask,
  fetchEmoccModelInfo,

  // 工具
  checkHealth,

  // 系统配置
  fetchKnowledgeKeywords,
};


// ========== 认证 API（支持直接 import） ==========

export async function login(username: string, password: string) {
  return request<{ token: string; expires_at: string; jti: string; user: AuthUser }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) }
  );
}

export async function register(username: string, password: string, nickname?: string) {
  return request<{ token: string; expires_at: string; jti: string; user: AuthUser }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ username, password, nickname }) }
  );
}

export async function logout() {
  return request<{ message: string }>('/api/auth/logout', { method: 'POST' });
}

export async function fetchMe() {
  return request<{
    id: number;
    username: string;
    nickname: string;
    email: string | null;
    avatar_color: string;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string | null;
  }>('/api/auth/me');
}

export async function changePassword(oldPassword: string, newPassword: string) {
  return request<{ message: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
}

export async function updateProfile(nickname: string) {
  return request<{ message: string }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  });
}
