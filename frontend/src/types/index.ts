export interface NavItem {
  id: string;
  label: string;
}

export interface FunctionCard {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  color: string;
  bg: string;
}

export interface User {
  id: number;
  name: string;
  avatar?: string;
  role?: string;
  status?: 'online' | 'offline';
}

export interface ChartData {
  name: string;
  value: number;
  color?: string;
}

export interface TimeSeriesData {
  time: string;
  value: number;
  category?: string;
}

// ==================== 模型相关类型（ModelCenterPage 与 RiskPage 共用） ====================

export interface ApiModel {
  id: string;
  name: string;
  provider: string;
  status: 'active' | 'inactive';
  createdAt: string;
  isBuiltin?: boolean;
  hasApiKey?: boolean;
  apiBaseUrl?: string;
  configTemplate?: string;
  description?: string;
}

export interface LocalModel {
  id: string;
  name: string;
  type: 'llm' | 'fealearner' | 'emoji';
  path: string;
  status: 'active' | 'inactive';
  createdAt: string;
  provider?: string;
  isBuiltin?: boolean;
}

// 统一模型类型（前端页面使用）
export interface UnifiedModel {
  id: number;
  modelName: string;
  modelCode: string;
  modelCategory: 'api' | 'local_llm' | 'detection';
  modelType: 'api' | 'ollama' | 'transformers' | 'fealearner' | 'emoji';
  provider?: string;
  description?: string;
  isAvailable: boolean;
  isBuiltin?: boolean;
  status: 'active' | 'inactive' | 'error';
  hasApiKey?: boolean;
  ollamaModelName?: string;
  ollamaBaseUrl?: string;
  modelPath?: string;
  modelFilePath?: string;
  embeddingFilePath?: string;
  apiBaseUrl?: string;
  configTemplate?: string;
  detectionType?: string;
  performanceMetrics?: Record<string, number>;
  supportedDatasets?: string[];
  createdAt: string;
}

// LLM 模型（联合类型：API 模型 + 本地 LLM）
export type LlmModel = (ApiModel | LocalModel) & { type: 'llm' | 'api' };

export interface PromptTemplate {
  id: string;
  name: string;
  taskType: string;
  description: string;
  content?: string;
  promptContent?: string;
  variables?: Record<string, string>;
  modelId?: number;
  isActive?: boolean;
  usageCount?: number;
  createdAt: string;
}

// ==================== 心理援助地图相关类型 ====================

export interface Institution {
  id: number | string;
  name: string;
  type?: string;
  address?: string;
  phone?: string;
  rating?: number;
  hours?: string;
  longitude?: number;
  latitude?: number;
  city?: string;
  district?: string;
  province?: string;
  data_source?: string;
  poi_id?: string;
  _distance?: number; // 计算属性：距离用户当前位置的距离（米）
  distance_km?: number; // 距离（公里）
}

export interface HotLine {
  id: number | string;
  hotline: string;
  name: string;
  region?: string;
  province?: string;
  city?: string;
  description?: string;
  source?: string;
  hotline_type?: string;
  is_emergency?: boolean;
  is_verified?: boolean;
  usage_count?: number;
  available?: string;
  isNational?: boolean;
}

export interface UserLocation {
  lat: number;
  lng: number;
  city?: string;
  district?: string;
  address?: string;
}

// ==================== API 响应类型 ====================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InstitutionStats {
  total: number;
  with_location: number;
  without_location: number;
  by_type: Array<{ type: string; count: number }>;
  by_city: Array<{ city: string; count: number }>;
  by_source: Array<{ source: string; count: number }>;
}

export interface HotLineStats {
  total: number;
  national: number;
  regional: number;
  by_region: Array<{ region: string; count: number }>;
  by_source: Array<{ source: string; count: number }>;
}

export interface CityInfo {
  name: string;
  institution_count?: number;
}

export interface RegionInfo {
  region: string;
  count: number;
}

// ==================== 认证相关类型 ====================

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  avatar_color: string;
  role: 'admin' | 'user';
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  jti: string;
  user: AuthUser;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
}
