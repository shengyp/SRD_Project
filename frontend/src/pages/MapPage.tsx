import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, MapPin, Phone, Clock, Star, Navigation,
  Building2, Siren, X,
  AlertTriangle,
  Locate, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { Modal, Select, Empty, message } from 'antd';
import { Institution, HotLine } from '../types';
import { fetchCityCoordinates } from '../api';

// ==================== 常量配置 ====================
// 机构类型定义 - 用于筛选
const INSTITUTION_TYPES = ['精神专科医院', '综合医院', '心理咨询中心', '三甲医院', '危机干预中心', '其他'];

// 默认城市坐标（fallback，当后端 API 不可用时使用）
const DEFAULT_CITY_COORDS: Record<string, [number, number]> = {
  '北京市': [116.4074, 39.9042], '上海市': [121.4737, 31.2304],
  '广州市': [113.2644, 23.1291], '深圳市': [114.3055, 22.5431],
  '成都市': [104.0665, 30.5728], '武汉市': [114.3055, 30.5928],
  '西安市': [108.9543, 34.3416], '南京市': [118.7969, 32.0603],
  '杭州市': [120.1536, 30.2744], '重庆市': [106.5516, 29.5630],
  '天津市': [117.2008, 39.1256], '长沙市': [112.9388, 28.2282],
  '郑州市': [113.6484, 34.7566], '沈阳市': [123.4328, 41.8087],
  '青岛市': [120.3826, 36.0671], '大连市': [121.6147, 38.9140],
  '哈尔滨市': [126.5340, 45.8038], '济南市': [116.9941, 36.6513],
  '石家庄市': [114.4788, 38.0495], '福州市': [119.3000, 26.0753],
  '厦门市': [118.0894, 24.4798], '南昌市': [115.8581, 28.6832],
  '昆明市': [102.7103, 25.0453], '贵阳市': [106.7107, 26.6043],
  '南宁市': [108.3661, 22.8173], '海口市': [110.1999, 20.0444],
  '太原市': [112.5489, 37.8724], '长春市': [125.3245, 43.8171],
  '合肥市': [117.2272, 31.8206], '兰州市': [103.8343, 36.0611],
  '乌鲁木齐市': [87.6168, 43.8266], '银川市': [106.2591, 38.4680],
  '西宁市': [101.7781, 36.6169], '拉萨市': [91.1171, 29.6500],
  '呼和浩特市': [111.7484, 40.8415], '苏州市': [120.5853, 31.2989],
  '无锡市': [120.3019, 31.5747], '宁波市': [121.5440, 29.8683],
  '温州市': [120.6997, 28.0006], '佛山市': [113.1219, 23.0218],
  '东莞市': [113.7518, 23.0205], '珠海市': [113.5624, 22.2569],
  '中山市': [113.3886, 22.5176], '惠州市': [114.4163, 23.1115],
  '江门市': [112.6834, 22.3787], '保定市': [115.4646, 38.8738],
  '唐山市': [118.1941, 39.9242], '洛阳市': [112.4540, 34.6197],
  '烟台市': [121.4478, 37.4639], '威海市': [122.1205, 37.5096],
  '汕头市': [116.6819, 23.3541], '湛江市': [110.3594, 21.2707],
};

// 机构类型映射 - 将数据库中的类型映射到标准化类型
const TYPE_MAPPING: Record<string, string> = {
  '精神专科医院': '精神专科医院',
  '精神科': '精神专科医院',
  '精神卫生中心': '精神专科医院',
  '精神病医院': '精神专科医院',
  '综合医院': '综合医院',
  '综合医院精神科': '综合医院',
  '心理咨询中心': '心理咨询中心',
  '心理咨询': '心理咨询中心',
  '心理中心': '心理咨询中心',
  '三甲医院': '三甲医院',
  '三级甲等': '三甲医院',
  '危机干预中心': '危机干预中心',
  '危机干预': '危机干预中心',
  '心理危机干预': '危机干预中心',
};

// 获取标准化类型
function normalizeType(type?: string): string {
  if (!type) return '其他';
  const normalized = TYPE_MAPPING[type];
  return normalized || '其他';
}

// 检查类型是否匹配
function typeMatches(instType: string | undefined, filterTypes: string[]): boolean {
  if (filterTypes.length === 0) return true;
  if (!instType) return filterTypes.includes('其他');
  const normalized = normalizeType(instType);
  return filterTypes.includes(normalized);
}

// 获取类型对应的颜色样式
function getTypeColorClass(type?: string): { bg: string; text: string } {
  const normalized = normalizeType(type);
  switch (normalized) {
    case '精神专科医院':
      return { bg: 'bg-red-100', text: 'text-red-600' };
    case '心理咨询中心':
      return { bg: 'bg-purple-100', text: 'text-purple-600' };
    case '危机干预中心':
      return { bg: 'bg-orange-100', text: 'text-orange-600' };
    case '综合医院':
      return { bg: 'bg-blue-100', text: 'text-blue-600' };
    case '三甲医院':
      return { bg: 'bg-yellow-100', text: 'text-yellow-600' };
    default:
      return { bg: 'bg-[#F4EBE1]', text: 'text-[#5C4D43]' };
  }
}

const RADIUS_OPTIONS = [
  { label: '1公里', value: 1000 },
  { label: '5公里', value: 5000 },
  { label: '10公里', value: 10000 },
  { label: '不限', value: Infinity },
];

const SORT_OPTIONS = [
  { label: '距离优先', value: 'distance' },
  { label: '评分优先', value: 'rating' },
  { label: '综合排序', value: 'comprehensive' },
];

// ==================== 工具函数 ====================
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters?: number): string {
  if (meters === undefined || meters === null) return '';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + 'km' : `${Math.round(meters)}m`;
}

// 加载高德地图 SDK（带重试机制）
let amapScriptLoaded = false;
let amapLoadPromise: Promise<void> | null = null;

async function loadAMapScript(key: string, securityCode: string): Promise<void> {
  if (amapScriptLoaded && (window as any).AMap) {
    return;
  }
  if (amapLoadPromise) {
    return amapLoadPromise;
  }

  amapLoadPromise = new Promise<void>((resolve, reject) => {
    // 设置安全密钥
    if (securityCode && !(window as any)._AMapSecurityConfig) {
      (window as any)._AMapSecurityConfig = { securityJsCode: securityCode };
    }

    // 检查是否已加载
    if ((window as any).AMap) {
      amapScriptLoaded = true;
      resolve();
      return;
    }

    // 移除已存在的脚本
    const existingScript = document.getElementById('amap-sdk');
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');
    script.id = 'amap-sdk';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Scale,AMap.ToolBar,AMap.Geolocation,AMap.Circle,AMap.Geocoder,AMap.CitySearch,AMap.MarkerClusterer`;
    script.async = true;
    script.onload = () => {
      amapScriptLoaded = true;
      // 等待地图对象初始化
      const checkReady = setInterval(() => {
        if ((window as any).AMap && (window as any).AMap.Map) {
          clearInterval(checkReady);
          resolve();
        }
      }, 50);
      // 超时保护
      setTimeout(() => {
        clearInterval(checkReady);
        if ((window as any).AMap) {
          resolve();
        } else {
          reject(new Error('高德地图初始化超时'));
        }
      }, 15000);
    };
    script.onerror = () => {
      amapLoadPromise = null;
      reject(new Error('高德地图 SDK 加载失败'));
    };
    document.head.appendChild(script);
  });

  return amapLoadPromise;
}

// ==================== API 基础地址 ====================
// 生产环境使用相对路径，通过 Nginx 代理转发
const API_BASE = import.meta.env.VITE_API_BASE || '';

// ==================== 机构详情弹窗 ====================
function InstitutionDetailModal({
  institution,
  onClose,
}: {
  institution: Institution;
  onClose: () => void;
}) {
  const getTypeColor = (type: string) => {
    switch (type) {
      case '精神专科医院': return 'bg-red-100 text-red-700 border border-red-200';
      case '综合医院': return 'bg-blue-100 text-blue-700 border border-blue-200';
      case '心理咨询中心': return 'bg-purple-100 text-purple-700 border border-purple-200';
      case '三甲医院': return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
      case '危机干预中心': return 'bg-orange-100 text-orange-700 border border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden m-4 animate-scale-in border border-[#EADDD5]">
        <div className="relative bg-gradient-to-r from-[#C19A83] to-[#A07D6B] p-6 text-white">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shadow-sm">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-bold mb-1">{institution.name}</h3>
              <span className={`inline-block px-3 py-0.5 rounded-full text-xs ${getTypeColor(institution.type || '')}`}>
                {institution.type || '其他'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-90">
            <Clock className="w-4 h-4" />
            <span>{institution.hours || '营业时间待补充'}</span>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-[#FAF6F3] rounded-xl flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-[#C19A83]" />
            </div>
            <div>
              <p className="text-xs text-[#8C7A6B] mb-1">地址</p>
              <p className="text-[#4A362C] font-medium text-sm">{institution.address || '暂无地址信息'}</p>
              <p className="text-xs text-[#8C7A6B]">{institution.city}{institution.district ? ` · ${institution.district}` : ''}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-[#FAF6F3] rounded-xl flex items-center justify-center shrink-0">
              <Phone className="w-5 h-5 text-[#C19A83]" />
            </div>
            <div>
              <p className="text-xs text-[#8C7A6B] mb-1">联系电话</p>
              {institution.phone ? (
                <a href={`tel:${institution.phone}`} className="text-[#4A362C] font-bold text-lg hover:text-[#C19A83] transition-colors">
                  {institution.phone}
                </a>
              ) : (
                <p className="text-[#8C7A6B]">暂无电话信息</p>
              )}
            </div>
          </div>

          {institution.rating !== undefined && (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-[#FAF6F3] rounded-xl flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 text-[#C19A83]" />
              </div>
              <div>
                <p className="text-xs text-[#8C7A6B] mb-1">评分</p>
                <div className="flex items-center gap-1">
                  <span className="text-[#4A362C] font-bold text-lg">{institution.rating}</span>
                  <span className="text-[#8C7A6B] text-sm">/ 5.0</span>
                </div>
              </div>
            </div>
          )}

          {institution._distance !== undefined && (
            <div className="flex items-center gap-2 text-sm text-[#8C7A6B]">
              <Navigation className="w-4 h-4" />
              <span>距离您约 {formatDistance(institution._distance)}</span>
            </div>
          )}

          {institution.data_source && (
            <div className="bg-[#FAF6F3] rounded-xl p-3 border border-[#EADDD5]">
              <p className="text-xs text-[#8C7A6B] mb-1">数据来源</p>
              <span className="px-2 py-0.5 bg-[#EADDD5] text-[#5C4D43] text-xs rounded-full">{institution.data_source}</span>
            </div>
          )}
        </div>

        <div className="p-6 pt-4 border-t border-[#EADDD5] flex gap-3">
          {institution.phone && (
            <a href={`tel:${institution.phone}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#C19A83] hover:bg-[#A07D6B] text-white rounded-xl transition-colors font-medium shadow-sm">
              <Phone className="w-5 h-5" />
              拨打电话
            </a>
          )}
          {(institution.longitude && institution.latitude) ? (
            <a
              href={`https://uri.amap.com/marker?position=${institution.longitude},${institution.latitude}&name=${encodeURIComponent(institution.name)}&src=vis4srd&nativeApp=false`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#4A362C] rounded-xl transition-colors font-medium">
              <MapPin className="w-5 h-5" />
              高德导航
            </a>
          ) : (
            <button
              onClick={() => message.warning('该机构暂无坐标信息')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#F4EBE1] text-[#8C7A6B] rounded-xl font-medium cursor-not-allowed opacity-60"
              disabled>
              <MapPin className="w-5 h-5" />
              暂无导航
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 热线详情弹窗 ====================
function HotLineModal({ hotline, onClose }: { hotline: HotLine; onClose: () => void }) {
  const isEmergency = hotline.hotline === '110' || hotline.hotline === '120';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 m-4 animate-scale-in border border-[#EADDD5]">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-[#F4EBE1] rounded-full transition-colors">
          <X className="w-5 h-5 text-[#8C7A6B]" />
        </button>
        <div className="text-center">
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${
            isEmergency ? 'bg-red-100 border-2 border-red-200' : 'bg-[#FAF6F3] border-2 border-[#EADDD5]'
          }`}>
            {isEmergency ? <Siren className="w-8 h-8 text-red-500" /> : <Phone className="w-8 h-8 text-[#C19A83]" />}
          </div>
          <h3 className="text-lg font-bold text-[#4A362C] mb-2">{hotline.name}</h3>
          <p className="text-3xl font-bold text-[#4A362C] mb-2">{hotline.hotline}</p>
          <p className="text-sm text-[#8C7A6B] mb-4">{hotline.description || '提供专业心理援助服务'}</p>
          <div className="flex items-center justify-center gap-2 text-sm text-[#8C7A6B] mb-6">
            <Clock className="w-4 h-4" />
            <span>{hotline.available || '24小时'}</span>
          </div>
          <a href={`tel:${hotline.hotline}`}
            className={`block w-full py-3 rounded-xl text-center font-semibold transition-colors shadow-sm ${
              isEmergency
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white'
            }`}>
            立即拨打
          </a>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面组件 ====================
export default function MapPage() {
  // ==================== 抽屉状态 ====================
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);

  // 筛选条件
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [searchRadius, setSearchRadius] = useState<number>(Infinity);
  const [sortBy, setSortBy] = useState<string>('distance');
  const [searchTerm, setSearchTerm] = useState('');

  // 定位状态
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState('');
  const [_userDistrict] = useState('');
  const [userAddress, setUserAddress] = useState('');
  const [locating, setLocating] = useState(false);

  // 数据
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [allCitiesList, setAllCitiesList] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [nationalHotlines, setNationalHotlines] = useState<HotLine[]>([]);
  const [localHotlines, setLocalHotlines] = useState<HotLine[]>([]);
  const [provinceHotlines, setProvinceHotlines] = useState<HotLine[]>([]);
  // 城市坐标映射（从后端 API 加载）
  const [cityCoords, setCityCoords] = useState<Record<string, [number, number]>>({});

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 弹窗
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null);
  const [hotlineModalVisible, setHotlineModalVisible] = useState(false);
  const [selectedHotLine, setSelectedHotLine] = useState<HotLine | null>(null);
  const [cityDialogVisible, setCityDialogVisible] = useState(false);

  // 地图
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const clusterRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);

  // ==================== 计算属性 ====================
  const filteredInstitutions = (() => {
    const term = searchTerm.trim().toLowerCase();
    const types = selectedTypes;
    const loc = userLocation;

    // 基于当前选中的城市进行初步筛选
    let list = institutions.filter(inst => {
      // 如果选择了城市（非全国），只显示该城市的机构
      if (selectedCity && inst.city && inst.city !== selectedCity) {
        return false;
      }
      return true;
    });

    // 计算距离
    list = list.map(inst => {
      const dist = (loc && inst.latitude && inst.longitude)
        ? getDistanceMeters(loc.lat, loc.lng, inst.latitude, inst.longitude)
        : undefined;
      return { ...inst, _distance: dist };
    });

    // 机构类型筛选 - 使用智能类型匹配
    if (types.length > 0) {
      list = list.filter(inst => typeMatches(inst.type, types));
    }
    // 名称/地址搜索
    if (term) {
      list = list.filter(inst =>
        inst.name.toLowerCase().includes(term) ||
        (inst.address && inst.address.toLowerCase().includes(term))
      );
    }
    // 距离筛选
    if (loc && searchRadius !== Infinity) {
      list = list.filter(inst => inst._distance !== undefined && inst._distance <= searchRadius);
    }

    // 排序
    if (sortBy === 'distance' && loc) {
      list = [...list].sort((a, b) => (a._distance ?? Infinity) - (b._distance ?? Infinity));
    } else if (sortBy === 'rating') {
      list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (sortBy === 'comprehensive') {
      list = [...list].sort((a, b) => {
        const sA = (a.rating ?? 3) * 1000 - (a._distance ?? 99999);
        const sB = (b.rating ?? 3) * 1000 - (b._distance ?? 99999);
        return sB - sA;
      });
    }
    return list;
  })();

  const paginatedInstitutions = filteredInstitutions.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const displayHotlines: HotLine[] = (() => {
    const results: HotLine[] = [];
    const existing = new Set<string>(); // 全局去重集合

    if (selectedCity) {
      // 选择了城市：只显示该城市的热线（本地 + 省份），不包括全国热线
      const cityHotlines = [
        ...localHotlines.filter(h => h.city === selectedCity || h.province === selectedCity),
        ...provinceHotlines.filter(h => h.city === selectedCity || h.province === selectedCity),
      ];
      // 城市热线去重
      const seenCityHotlines = new Set<string>();
      cityHotlines.forEach(h => {
        if (!seenCityHotlines.has(h.hotline)) {
          seenCityHotlines.add(h.hotline);
          results.push({ ...h, isNational: false, available: h.available || '24小时' } as HotLine);
          existing.add(h.hotline);
        }
      });
    } else {
      // 未选择城市时，只显示全国热线
      nationalHotlines.forEach(h => {
        if (!existing.has(h.hotline)) {
          results.push({ ...h, available: '24小时', isNational: true } as HotLine);
          existing.add(h.hotline);
        }
      });
    }
    return results.slice(0, 6);
  })();

  // ==================== API ====================
  const fetchInstitutions = useCallback(async (city?: string) => {
    try {
      const params = new URLSearchParams({ page: '1', limit: '10000' });
      if (city) params.append('city', city);
      const res = await fetch(`${API_BASE}/api/institutions?${params}`);
      const data = await res.json();
      if (data.success && data.data) {
        setInstitutions(data.data);
        updateMapMarkers(data.data);
      }
    } catch { message.error('获取机构数据失败'); }
  }, []);

  const fetchCities = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cities`);
      const data = await res.json();
      if (data.success && data.data) {
        // API 返回 {name, institution_count} 对象数组，提取 name
        const cityNames = data.data.map((c: any) => c.name);
        setAllCitiesList(cityNames);
      }
    } catch { /* silent */ }
  }, []);

  const fetchHotlines = useCallback(async (city?: string) => {
    const targetCity = city ?? selectedCity ?? userCity ?? '';
    try {
      const nr = await fetch(`${API_BASE}/api/hotlines/national`);
      const nd = await nr.json();
      if (nd.success) setNationalHotlines(nd.data);
      if (targetCity) {
        const lr = await fetch(`${API_BASE}/api/hotlines/local?city=${encodeURIComponent(targetCity)}`);
        const ld = await lr.json();
        if (ld.success) setLocalHotlines(ld.data);
        const provinceMappings: Record<string, string> = {
          '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
          '广州市': '广东', '成都市': '四川', '武汉市': '湖北', '西安市': '陕西',
          '南京市': '江苏', '杭州市': '浙江', '长沙市': '湖南', '郑州市': '河南',
        };
        const province = provinceMappings[targetCity] || targetCity.replace(/市$/, '');
        const pr = await fetch(`${API_BASE}/api/hotlines?province=${encodeURIComponent(province)}`);
        const pd = await pr.json();
        if (pd.success) setProvinceHotlines(pd.data);
      }
    } catch { /* silent */ }
  }, [selectedCity, userCity]);

  // ==================== 定位功能（简洁版）====================

  // 重新定位：优先GPS，失败则IP定位，默认荣昌区
  const handleLocate = useCallback(async () => {
    if (!mapInstanceRef.current) return;
    setLocating(true);

    // 1. 尝试浏览器GPS定位
    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        console.log(`GPS定位成功: ${lng}, ${lat}, 精度: ${accuracy}m`);

        // 尝试使用高德本地地理编码（如果 SDK 可用）
        const amapGeocode = new Promise<string>((resolve) => {
          try {
            const geocoder = new (window as any).AMap.Geocoder({ radius: 1000, extensions: 'all' });
            geocoder.getAddress([lng, lat], (status: string, result: any) => {
              if (status === 'complete' && result.regeocode) {
                const ac = result.regeocode.addressComponent;
                const province = ac.province || '';
                const city = ac.city || province;
                const district = ac.district || '';
                const street = ac.street || '';
                const streetNumber = ac.streetNumber || '';

                let displayAddr = '';
                if (street && streetNumber) {
                  displayAddr = district + street + streetNumber;
                } else if (street) {
                  displayAddr = district + street;
                } else if (district) {
                  displayAddr = district;
                } else {
                  displayAddr = city;
                }

                // 设置城市信息
                setUserCity(city.replace(/市$/, ''));
                setUserAddress(displayAddr);

                resolve(displayAddr || '当前位置');
              } else {
                resolve(''); // 返回空字符串表示失败
              }
            });
          } catch (e) {
            console.warn('高德地理编码失败:', e);
            resolve('');
          }
        });

        // 尝试使用后端逆地理编码 API
        const backendGeocode = (async () => {
          try {
            const res = await fetch(`${API_BASE}/api/geocode/reverse?lat=${lat}&lng=${lng}`);
            const data = await res.json();
            if (data.success && data.data) {
              const addr = data.data.shortAddress || data.data.formattedAddress || '';
              if (addr) {
                setUserCity((data.data.city || '').replace(/市$/, ''));
                setUserAddress(addr);
                return addr;
              }
            }
          } catch (e) {
            console.warn('后端逆地理编码失败:', e);
          }
          return '';
        })();

        // 并行获取地址，优先使用高德结果，3秒超时
        const address = await Promise.race([
          amapGeocode.then(addr => addr || backendGeocode),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000))
        ]) || await backendGeocode;

        // 如果都无法获取地址，显示坐标
        if (!address) {
          const coordAddr = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setUserCity('');
          setUserAddress(coordAddr);
        }

        setUserLocation({ lat, lng });
        mapInstanceRef.current.setCenter([lng, lat]);
        mapInstanceRef.current.setZoom(16);

        if (userMarkerRef.current) mapInstanceRef.current.remove(userMarkerRef.current);
        userMarkerRef.current = new (window as any).AMap.Marker({
          position: [lng, lat],
          content: '<div style="width:16px;height:16px;background:#C19A83;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(193,154,131,0.3);"><div style="width:6px;height:6px;background:white;border-radius:50%;margin:3px;"></div></div>',
          offset: new (window as any).AMap.Pixel(-8, -8),
          zIndex: 200,
        });
        mapInstanceRef.current.add(userMarkerRef.current);

        // 添加精度圆（先移除旧的）
        if (radiusCircleRef.current) {
          mapInstanceRef.current.remove(radiusCircleRef.current);
          radiusCircleRef.current = null;
        }
        if (accuracy && accuracy < 1000) {
          radiusCircleRef.current = new (window as any).AMap.Circle({
            center: [lng, lat],
            radius: accuracy,
            strokeColor: '#C19A83',
            strokeWeight: 1,
            fillColor: '#C19A83',
            fillOpacity: 0.05,
            zIndex: 10,
          });
          mapInstanceRef.current.add(radiusCircleRef.current);
        }

        message.success(`已定位到：${address}`);
        setLocating(false);
        return;
      } catch (e) {
        console.warn('GPS定位失败:', e);
      }
    }

    // 2. 尝试使用高德浏览器定位插件（更准确）
    try {
      const amapPosition = await new Promise<{ lng: number; lat: number; city: string; district: string; address: string }>((resolve, reject) => {
        if (!(window as any).AMap) {
          reject(new Error('AMap未加载'));
          return;
        }
        (window as any).AMap.plugin('AMap.Geolocation', () => {
          const geo = new (window as any).AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 10000,
            GeoLocationFirst: true,
            convert: true,
            noIpLocate: 0,
            extensions: 'all', // 获取完整地址信息
          });
          geo.getCurrentPosition((status: string, result: any) => {
            if (status === 'complete' && result.position) {
              // 尝试获取更详细的地址信息
              const ac = result.addressComponent || {};
              const city = ac.city || result.city || '';
              const district = ac.district || '';
              const township = ac.township || '';
              // 优先使用区县+街道作为地址
              const fullAddress = district + township || city;
              resolve({
                lng: result.position.lng,
                lat: result.position.lat,
                city: city,
                district: district,
                address: fullAddress || city,
              });
            } else {
              reject(new Error('AMap定位失败'));
            }
          });
        });
      });

      const { lng, lat, city, address } = amapPosition;
      setUserLocation({ lat, lng });
      setUserCity(city.replace(/市$/, '') || '当前位置');
      // 优先显示详细地址，否则显示城市名
      setUserAddress(address || city || '当前位置');
      mapInstanceRef.current.setCenter([lng, lat]);
      mapInstanceRef.current.setZoom(14);

      if (userMarkerRef.current) mapInstanceRef.current.remove(userMarkerRef.current);
      userMarkerRef.current = new (window as any).AMap.Marker({
        position: [lng, lat],
        content: '<div style="width:16px;height:16px;background:#C19A83;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(193,154,131,0.3);"><div style="width:6px;height:6px;background:white;border-radius:50%;margin:3px;"></div></div>',
        offset: new (window as any).AMap.Pixel(-8, -8),
        zIndex: 200,
      });
      mapInstanceRef.current.add(userMarkerRef.current);
      message.success(`已定位到：${address || city || '当前位置'}`);
      setLocating(false);
      return;
    } catch (e) {
      console.warn('高德定位插件失败:', e);
    }

    // 3. 尝试后端IP定位
    try {
      const res = await fetch(`${API_BASE}/api/ip-location`);
      const data = await res.json();
      if (data.success && data.data) {
        const { city, longitude, latitude, source } = data.data;
        console.log(`IP定位成功: ${city}, 来源: ${source}`);

        // 优先使用返回的真实坐标
        const coords = cityCoords[city || ''] || DEFAULT_CITY_COORDS[city || ''] || [105.5936, 29.4048];
        const lng = longitude || coords[0];
        const lat = latitude || coords[1];

        setUserCity(city?.replace(/市$/, '') || '');
        setUserAddress(city || '当前位置');
        setUserLocation({ lat, lng });
        mapInstanceRef.current.setCenter([lng, lat]);
        mapInstanceRef.current.setZoom(12);

        if (userMarkerRef.current) mapInstanceRef.current.remove(userMarkerRef.current);
        userMarkerRef.current = new (window as any).AMap.Marker({
          position: [lng, lat],
          content: '<div style="width:16px;height:16px;background:#C19A83;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(193,154,131,0.3);"><div style="width:6px;height:6px;background:white;border-radius:50%;margin:3px;"></div></div>',
          offset: new (window as any).AMap.Pixel(-8, -8),
          zIndex: 200,
        });
        mapInstanceRef.current.add(userMarkerRef.current);
        message.success(`已定位到：${city || '当前位置'}`);
        setLocating(false);
        return;
      }
    } catch (e) {
      console.warn('IP定位失败:', e);
    }

    // 4. 基于浏览器时区和语言猜测位置
    const guessFromBrowser = (): { city: string; coords: [number, number] } => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language || navigator.languages?.[0] || '';

      // 中国时区
      const cnTimezones = ['Asia/Shanghai', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Chongqing'];
      const isChinese = lang.startsWith('zh') || cnTimezones.some(tz => timezone.includes(tz.split('/')[1]));

      if (isChinese) {
        // 尝试从时区推断城市
        if (timezone.includes('Shanghai') || timezone.includes('Chongqing')) {
          return { city: '重庆市', coords: [106.5516, 29.5630] };
        }
        if (timezone.includes('Harbin')) {
          return { city: '哈尔滨市', coords: [126.5340, 45.8038] };
        }
        if (timezone.includes('Urumqi')) {
          return { city: '乌鲁木齐市', coords: [87.6168, 43.8266] };
        }
        // 默认重庆
        return { city: '重庆市', coords: [106.5516, 29.5630] };
      }

      // 非中文默认北京
      return { city: '北京市', coords: [116.4074, 39.9042] };
    };

    // 5. 默认定位到荣昌区
    const guess = guessFromBrowser();
    setUserCity(guess.city.replace(/市$/, ''));
    setUserAddress(guess.city);
    setUserLocation({ lng: guess.coords[0], lat: guess.coords[1] });
    mapInstanceRef.current.setCenter(guess.coords);
    mapInstanceRef.current.setZoom(12);

    if (userMarkerRef.current) mapInstanceRef.current.remove(userMarkerRef.current);
    userMarkerRef.current = new (window as any).AMap.Marker({
      position: guess.coords,
      content: '<div style="width:16px;height:16px;background:#C19A83;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(193,154,131,0.3);"><div style="width:6px;height:6px;background:white;border-radius:50%;margin:3px;"></div></div>',
      offset: new (window as any).AMap.Pixel(-8, -8),
      zIndex: 200,
    });
    mapInstanceRef.current.add(userMarkerRef.current);
    message.info(`已定位到：${guess.city}（基于浏览器设置）`);
    setLocating(false);
  }, [cityCoords]);

  // ==================== 地图 ====================
  const getTypeColorForMarker = (type?: string) => {
    const normalized = normalizeType(type);
    switch (normalized) {
      case '精神专科医院': return 'linear-gradient(135deg, #e74c3c, #c0392b)';
      case '心理咨询中心': return 'linear-gradient(135deg, #9b59b6, #8e44ad)';
      case '危机干预中心': return 'linear-gradient(135deg, #e67e22, #d35400)';
      case '综合医院': return 'linear-gradient(135deg, #3498db, #2980b9)';
      case '三甲医院': return 'linear-gradient(135deg, #f39c12, #e67e22)';
      default: return 'linear-gradient(135deg, #C19A83, #A07D6B)';
    }
  };

  const updateMapMarkers = useCallback((list: Institution[]) => {
    if (!mapInstanceRef.current) return;
    if (clusterRef.current) { clusterRef.current.setMap(null); clusterRef.current = null; }
    markersRef.current.forEach(m => mapInstanceRef.current.remove(m));
    markersRef.current = [];

    list.forEach(inst => {
      if (!inst.longitude || !inst.latitude) return;
      const markerContent = document.createElement('div');
      markerContent.innerHTML = `<div style="width:32px;height:32px;background:${getTypeColorForMarker(inst.type || '')};border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:all 0.3s;"><span style="transform:rotate(45deg);font-size:14px;">🏥</span></div>`;
      const marker = new (window as any).AMap.Marker({
        position: [inst.longitude, inst.latitude],
        content: markerContent,
        offset: new (window as any).AMap.Pixel(-16, -32),
        extData: inst,
      });
      marker.on('click', () => showMarkerInfo(inst));
      markersRef.current.push(marker);
    });

    const useCluster = selectedCity === '' && markersRef.current.length > 100;
    if (useCluster) {
      clusterRef.current = new (window as any).AMap.MarkerClusterer(mapInstanceRef.current, [], { gridSize: 80 });
      clusterRef.current.setData(markersRef.current.map(m => ({ lnglat: m.getPosition(), marker: m })));
    } else {
      markersRef.current.forEach(m => mapInstanceRef.current.add(m));
    }

    if (markersRef.current.length > 0 && !userLocation) {
      if (markersRef.current.length === 1 && list[0]) {
        mapInstanceRef.current.setCenter([list[0].longitude!, list[0].latitude!]);
        mapInstanceRef.current.setZoom(14);
      } else {
        mapInstanceRef.current.setFitView(markersRef.current, false, [50, 50, 50, 50], 15);
      }
    }
  }, [selectedCity, userLocation]);

  const showMarkerInfo = useCallback((inst: Institution) => {
    if (!mapInstanceRef.current || !infoWindowRef.current) return;
    const instId = String(inst.id);
    const content = `
      <div style="padding:10px;min-width:220px;border-radius:12px;background:white;border:1px solid #EADDD5;">
        <h4 style="margin:0 0 8px;color:#4A362C;font-size:14px;font-weight:600;">${inst.name}</h4>
        <p style="margin:4px 0;color:#8C7A6B;font-size:12px;">🏥 ${inst.type || '未知类型'}</p>
        <p style="margin:4px 0;color:#8C7A6B;font-size:12px;">📍 ${inst.address || '暂无地址'}</p>
        <p style="margin:4px 0;color:#8C7A6B;font-size:12px;">📞 ${inst.phone || '暂无电话'}</p>
        ${inst.rating ? `<p style="margin:4px 0;color:#C19A83;font-size:12px;">⭐ ${inst.rating}/5.0</p>` : ''}
        <button id="__show_detail_btn_${instId}" style="margin-top:8px;padding:5px 14px;background:#C19A83;color:white;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;">查看详情</button>
      </div>
    `;
    infoWindowRef.current.setContent(content);
    infoWindowRef.current.open(mapInstanceRef.current, new (window as any).AMap.LngLat(inst.longitude!, inst.latitude!));

    // 延迟绑定按钮事件，等待 DOM 渲染
    setTimeout(() => {
      const btn = document.getElementById(`__show_detail_btn_${instId}`);
      if (btn) {
        btn.addEventListener('click', () => {
          setSelectedInstitution(inst);
          setDetailModalVisible(true);
          if (infoWindowRef.current) infoWindowRef.current.close();
        });
      }
    }, 100);
  }, []);

  const initMap = useCallback(async () => {
    try {
      setMapLoading(true);
      setMapError(null);

      const key = import.meta.env.VITE_AMAP_KEY || import.meta.env.VITE_AMAP_JS_KEY || '';
      const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE || '';

      // 加载高德地图 SDK
      await loadAMapScript(key, securityCode);

      // 等待地图容器就绪（带超时保护）
      await new Promise<void>((resolve) => {
        const startTime = Date.now();
        const timeout = 10000;
        const check = () => {
          const container = document.getElementById('gaode-map-container');
          if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
            resolve();
          } else if (Date.now() - startTime > timeout) {
            console.warn('地图容器检测超时');
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      const map = new (window as any).AMap.Map('gaode-map-container', {
        zoom: 12,
        center: [106.5, 29.5],
        viewMode: '2D',
        mapStyle: 'amap://styles/normal',
        features: ['bg', 'road', 'building', 'point'],
        showIndoorMap: false,
        resizeEnable: true,
        pitchEnable: false,
        rotateEnable: false,
      });

      mapInstanceRef.current = map;
      infoWindowRef.current = new (window as any).AMap.InfoWindow({ offset: new (window as any).AMap.Pixel(0, -30) });

      // 监听地图错误事件
      map.on('error', (e: any) => {
        console.warn('地图错误:', e);
      });

      // 添加地图控件和边界限制
      map.plugin(['AMap.Scale', 'AMap.ToolBar', 'AMap.Geolocation', 'AMap.Circle', 'AMap.Geocoder', 'AMap.CitySearch', 'AMap.MarkerClusterer'], () => {
        try {
          map.addControl(new (window as any).AMap.Scale());
          map.addControl(new (window as any).AMap.ToolBar());
          map.setLimitBounds(new (window as any).AMap.Bounds(
            new (window as any).AMap.LngLat(73.33, 3.52),
            new (window as any).AMap.LngLat(135.05, 53.55),
          ));
        } catch (e) {
          console.warn('地图控件添加失败:', e);
        }
      });

      // 监听地图完成事件（瓦片加载完成后触发）
      map.on('complete', () => {
        console.log('地图瓦片加载完成');
      });

      // 设置超时检测：如果地图未加载完成则显示提示
      setTimeout(() => {
        const container = document.getElementById('gaode-map-container');
        const canvas = container?.querySelector('canvas');
        if (!canvas) {
          console.warn('地图瓦片可能未加载，显示地图但不保证完全可用');
        }
      }, 5000);

      // 先只获取全国热线数据（城市未知，先显示全国热线）
      fetchHotlines('');

      // 调用统一的定位逻辑（已简化为 handleLocate）
      await handleLocate();

      // 根据定位结果获取机构数据
      fetchInstitutions(userCity || selectedCity || '');
      setMapLoading(false);
    } catch (err) {
      console.error('地图初始化失败:', err);
      setMapError('地图加载失败，请检查网络连接或刷新页面重试');
      setMapLoading(false);
    }
  }, [handleLocate, userCity, selectedCity, fetchHotlines, fetchInstitutions]);

  const handleCityChange = useCallback((city: string) => {
    setSelectedCity(city);
    setCurrentPage(1);
    fetchInstitutions(city);
    fetchHotlines(city);
    if (mapInstanceRef.current) {
      const coords = cityCoords[city] || DEFAULT_CITY_COORDS[city] || [116.4074, 39.9042];
      mapInstanceRef.current.setCenter(coords);
      mapInstanceRef.current.setZoom(12);
    }
  }, [fetchInstitutions, fetchHotlines, cityCoords]);

  const handleInstitutionClick = useCallback((inst: Institution) => {
    setSelectedInstitution(inst);
    setDetailModalVisible(true);
    if (mapInstanceRef.current && inst.longitude && inst.latitude) {
      mapInstanceRef.current.setCenter([inst.longitude, inst.latitude]);
      mapInstanceRef.current.setZoom(17);
      setTimeout(() => showMarkerInfo(inst), 300);
    }
  }, [showMarkerInfo]);

  // 标记是否已初始化
  const initRef = useRef(false);

  // 生命周期
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      initMap();
      fetchCities();
      // 从后端 API 加载城市坐标
      fetchCityCoordinates().then(data => {
        if (data && typeof data === 'object') {
          setCityCoords(data as Record<string, [number, number]>);
        }
      }).catch(() => {});
    }
  }, []);

  // 监听城市变化，自动重新获取机构数据和热线
  useEffect(() => {
    if (initRef.current && selectedCity !== undefined) {
      fetchInstitutions(selectedCity);
      fetchHotlines(selectedCity);
    }
  }, [selectedCity]);

  // 当筛选条件变化时更新地图标记
  useEffect(() => {
    updateMapMarkers(filteredInstitutions);
  }, [filteredInstitutions, updateMapMarkers]);

  useEffect(() => {
    if (userLocation && searchRadius !== Infinity && mapInstanceRef.current) {
      if (radiusCircleRef.current) mapInstanceRef.current.remove(radiusCircleRef.current);
      radiusCircleRef.current = new (window as any).AMap.Circle({
        center: [userLocation.lng, userLocation.lat],
        radius: searchRadius,
        strokeColor: '#C19A83',
        strokeWeight: 2,
        fillColor: '#C19A83',
        fillOpacity: 0.08,
        zIndex: 10,
      });
      mapInstanceRef.current.add(radiusCircleRef.current);
    } else if (radiusCircleRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.remove(radiusCircleRef.current);
    }
  }, [userLocation, searchRadius]);

  // ==================== 渲染 ====================
  return (
    <div className="absolute inset-0 overflow-x-hidden overflow-y-hidden">
      {/* ==================== 满屏地图（背景层）==================== */}
      <div
        id="gaode-map-container"
        ref={mapContainerRef}
        className="absolute inset-0 z-0"
        style={{ width: '100%', height: '100%' }}
      />

      {/* 地图加载遮罩 */}
      {mapLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm pointer-events-none">
          <div className="w-14 h-14 border-4 border-[#EADDD5] border-t-[#C19A83] rounded-full animate-spin mb-4" />
          <p className="text-[#8C7A6B] text-sm font-medium">地图加载中...</p>
        </div>
      )}

      {/* 地图错误遮罩 */}
      {mapError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm">
          <div className="w-20 h-20 bg-[#FAF6F3] rounded-full flex items-center justify-center mb-5 shadow-sm">
            <MapPin className="w-10 h-10 text-[#C19A83]" />
          </div>
          <p className="text-[#4A362C] font-semibold text-lg mb-2">{mapError}</p>
          <div className="text-[#8C7A6B] text-sm mb-4 text-center max-w-md px-4">
            <p className="mb-2">可能原因：</p>
            <ul className="text-left list-disc pl-5 space-y-1">
              <li>网络连接不稳定</li>
              <li>VPN 或代理可能阻止了高德地图请求</li>
              <li>防火墙阻止了对 amap.com 的访问</li>
            </ul>
          </div>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => {
                setMapError(null);
                setMapLoading(true);
                // 重置脚本加载状态并重新加载
                amapScriptLoaded = false;
                amapLoadPromise = null;
                initMap();
              }}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#C19A83] to-[#A07D6B] hover:from-[#A07D6B] hover:to-[#8B6B58] text-white rounded-xl text-sm transition-all shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              重试加载
            </button>
            <button
              onClick={() => {
                setMapError(null);
                setMapLoading(false);
                message.info('部分功能可能受限，建议检查网络后刷新页面');
              }}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5C4D43] rounded-xl text-sm transition-colors border border-[#EADDD5]"
            >
              继续使用
            </button>
          </div>
        </div>
      )}

      {/* ==================== 左侧筛选抽屉（Left Drawer）==================== */}
      {/* 左侧抽屉开关按钮（始终显示在左侧边缘） */}
      <button
        onClick={() => setLeftOpen(!leftOpen)}
        className="absolute top-1/2 -translate-y-1/2 z-30 w-7 h-14 flex items-center justify-center rounded-r-xl shadow-lg transition-all duration-300"
        style={{
          left: leftOpen ? '280px' : '0px',
          background: leftOpen ? '#C19A83' : 'white',
          color: leftOpen ? 'white' : '#C19A83',
          border: leftOpen ? 'none' : '1px solid #EADDD5',
        }}
      >
        {leftOpen
          ? <ArrowLeft className="w-4 h-4" />
          : <ArrowRight className="w-4 h-4" />
        }
      </button>

      {/* 左侧抽屉主体 */}
      <div
        className="absolute inset-y-0 left-0 z-20 transition-all duration-300 ease-in-out overflow-hidden"
        style={{ width: leftOpen ? '280px' : '0px' }}
      >
        {leftOpen && (
          <div 
            className="w-[280px] h-full flex flex-col bg-white overflow-hidden shadow-[2px_0_16px_rgba(0,0,0,0.08)] border-r border-[#EADDD5]"
            style={{ paddingBottom: '44px' }}
          >
            {/* 定位头部 */}
            <div className="p-4 border-b border-[#EADDD5] bg-gradient-to-r from-[#F9F5F2] to-white">
              <div className="flex items-center gap-2 text-[#8C7A6B] text-xs mb-3">
                <Locate className="w-3.5 h-3.5 shrink-0 text-[#C19A83]" />
                <span className="truncate">{userAddress || userCity || '点击定位获取当前位置'}</span>
              </div>
              <button
                onClick={handleLocate}
                disabled={locating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#C19A83] to-[#A07D6B] hover:from-[#A07D6B] hover:to-[#8B6B58] text-white rounded-xl text-sm transition-all shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
                {locating ? '定位中...' : '重新定位'}
              </button>
            </div>

            {/* 筛选内容 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* 机构类型 */}
              <div>
                <h4 className="text-xs font-semibold text-[#5C4D43] mb-3 uppercase tracking-wide">机构类型</h4>
                <div className="space-y-2">
                  {INSTITUTION_TYPES.map(type => (
                    <label key={type} className="flex items-center gap-2.5 cursor-pointer group" onClick={(e) => {
                      e.preventDefault();
                      setSelectedTypes(prev =>
                        prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                      );
                      setCurrentPage(1);
                    }}>
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                        selectedTypes.includes(type)
                          ? 'bg-[#C19A83] border-[#C19A83]'
                          : 'border-[#D7BFA6] group-hover:border-[#C19A83]'
                      }`}>
                        {selectedTypes.includes(type) && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="text-sm text-[#5C4D43] group-hover:text-[#C19A83] transition-colors">{type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 搜索半径 */}
              <div>
                <h4 className="text-xs font-semibold text-[#5C4D43] mb-3 uppercase tracking-wide">搜索半径</h4>
                <div className="grid grid-cols-2 gap-2">
                  {RADIUS_OPTIONS.map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => setSearchRadius(opt.value)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                        searchRadius === opt.value
                          ? 'bg-gradient-to-r from-[#C19A83] to-[#A07D6B] border-[#C19A83] text-white shadow-sm'
                          : 'bg-[#FAF6F3] border-[#EADDD5] text-[#5C4D43] hover:bg-[#F4EBE1] hover:border-[#D7BFA6]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 排序方式 */}
              <div>
                <h4 className="text-xs font-semibold text-[#5C4D43] mb-3 uppercase tracking-wide">排序方式</h4>
                <div className="space-y-1.5">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSortBy(opt.value)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                        sortBy === opt.value
                          ? 'bg-gradient-to-r from-[#C19A83] to-[#A07D6B] border-[#C19A83] text-white shadow-sm'
                          : 'bg-[#FAF6F3] border-[#EADDD5] text-[#5C4D43] hover:bg-[#F4EBE1] hover:border-[#D7BFA6]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 右侧机构列表面板（Right Drawer）==================== */}
      {/* 右侧抽屉开关按钮（始终显示在右侧边缘） */}
      <button
        onClick={() => setRightOpen(!rightOpen)}
        className="absolute top-1/2 -translate-y-1/2 z-30 w-7 h-14 flex items-center justify-center rounded-l-xl shadow-lg transition-all duration-300"
        style={{
          right: rightOpen ? '400px' : '0px',
          background: rightOpen ? '#C19A83' : 'white',
          color: rightOpen ? 'white' : '#C19A83',
          border: rightOpen ? 'none' : '1px solid #EADDD5',
        }}
        title={rightOpen ? '收起机构列表' : '展开机构列表'}
      >
        {rightOpen
          ? <ArrowRight className="w-4 h-4" />
          : <ArrowLeft className="w-4 h-4" />
        }
      </button>

      {/* 右侧抽屉主体 */}
      <div
        className="absolute top-0 bottom-0 z-20 transition-all duration-300 ease-in-out overflow-hidden"
        style={{
          right: rightOpen ? '0px' : '0px',
          width: rightOpen ? '400px' : '0px',
          // 底部留出热线栏的空间（44px是热线栏收起时的高度）
          paddingBottom: rightOpen ? '44px' : '0px',
        }}
      >
        {rightOpen && (
          <div className="w-[400px] h-full flex flex-col bg-white overflow-hidden shadow-[-2px_0_16px_rgba(0,0,0,0.1)] border-l border-[#EADDD5]">
            {/* 搜索头 */}
            <div className="p-4 border-b border-[#EADDD5] bg-gradient-to-r from-[#F9F5F2] to-white shrink-0">
              {/* 统计条 */}
              <div className="flex border border-[#EADDD5] rounded-xl overflow-hidden mb-3">
                <div
                  className="flex-1 p-3 text-center cursor-pointer hover:bg-[#FAF6F3] transition-colors"
                  onClick={() => setCityDialogVisible(true)}
                >
                  <p className="text-lg font-bold text-[#C19A83]">{allCitiesList.length}</p>
                  <p className="text-[10px] text-[#8C7A6B]">覆盖城市</p>
                </div>
                <div className="w-px bg-[#EADDD5]" />
                <div className="flex-1 p-3 text-center">
                  <p className="text-lg font-bold text-[#C19A83]">{filteredInstitutions.length}</p>
                  <p className="text-[10px] text-[#8C7A6B]">机构总数</p>
                </div>
              </div>

              {/* 搜索框 */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A89F95]" />
                <input
                  type="text"
                  placeholder="搜索机构名称..."
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="w-full pl-10 pr-4 py-2.5 border border-[#EADDD5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D7BFA6] focus:border-[#C19A83] bg-white transition-all placeholder:text-[#A89F95]"
                />
              </div>

              {/* 城市下拉 */}
              <div className="mt-3">
                <Select
                  placeholder="选择城市筛选"
                  value={selectedCity || undefined}
                  onChange={handleCityChange}
                  allowClear
                  className="w-full"
                  popupClassName="!min-w-[200px]"
                  options={[
                    { value: '', label: '全国' },
                    ...allCitiesList.map(c => ({ value: c, label: c })),
                  ]}
                />
              </div>
            </div>

            {/* 机构列表 */}
            <div className="flex-1 overflow-y-auto bg-[#F9F5F2]">
              {paginatedInstitutions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-[#8C7A6B]">暂无符合条件的机构</span>} />
                </div>
              ) : (
                <div className="divide-y divide-[#EADDD5]">
                  {paginatedInstitutions.map((inst, idx) => {
                    const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                    const typeColor = getTypeColorClass(inst.type);
                    return (
                      <div
                        key={inst.id}
                        onClick={() => handleInstitutionClick(inst)}
                        className="p-4 hover:bg-white cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold shadow-sm ${typeColor.bg} ${typeColor.text}`}>
                            {globalIdx}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <h4 className="font-semibold text-[#4A362C] text-sm truncate pr-2">{inst.name}</h4>
                              <ChevronRight className="w-4 h-4 text-[#A89F95] shrink-0" />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mb-2">
                              {inst.type && (
                                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${typeColor.bg} ${typeColor.text.replace('6', '700')}`}>{inst.type}</span>
                              )}
                              {inst.city && (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{inst.city}</span>
                              )}
                              {inst._distance !== undefined && (
                                <span className="px-2 py-0.5 bg-[#F4EBE1] text-[#5C4D43] text-xs rounded-full flex items-center gap-0.5">
                                  <Navigation className="w-2.5 h-2.5" />
                                  {formatDistance(inst._distance)}
                                </span>
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {inst.phone && (
                                <p className="text-xs text-[#8C7A6B] flex items-center gap-1">
                                  <Phone className="w-3 h-3 shrink-0" />
                                  {inst.phone}
                                </p>
                              )}
                              {inst.address && (
                                <p className="text-xs text-[#8C7A6B] flex items-center gap-1 truncate">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  {inst.address}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 分页 */}
            {filteredInstitutions.length > pageSize && (
              <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-white border-t border-[#EADDD5]">
                <span className="text-xs text-[#8C7A6B]">共 {filteredInstitutions.length} 条</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 text-xs rounded-lg text-[#5C4D43] hover:bg-[#F4EBE1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >上一页</button>
                  {Array.from({ length: Math.min(5, Math.ceil(filteredInstitutions.length / pageSize)) }, (_, i) => {
                    const total = Math.ceil(filteredInstitutions.length / pageSize);
                    let page = i + 1;
                    if (total > 5) { if (currentPage > 3) page = currentPage - 2 + i; if (currentPage > total - 2) page = total - 4 + i; }
                    return (
                      <button key={page} onClick={() => setCurrentPage(page)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                          currentPage === page ? 'bg-[#C19A83] text-white' : 'text-[#5C4D43] hover:bg-[#F4EBE1]'
                        }`}>{page}</button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredInstitutions.length / pageSize), p + 1))}
                    disabled={currentPage === Math.ceil(filteredInstitutions.length / pageSize)}
                    className="px-2.5 py-1 text-xs rounded-lg text-[#5C4D43] hover:bg-[#F4EBE1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >下一页</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部空隙填充块 - 覆盖左侧抽屉与底部热线之间的缝隙 */}
      {leftOpen && (
        <div
          className="absolute left-0 bottom-0 w-[280px] h-24 bg-white z-[25] pointer-events-none"
          style={{ boxShadow: '2px 0 8px rgba(0,0,0,0.06)' }}
        />
      )}

      {/* ==================== 底部紧急热线抽屉（Bottom Drawer）==================== */}
      {/* 底部抽屉主体 - 紧贴主区域底部，无空隙；收起按钮在标题行右侧，不遮挡内容 */}
      <div
        className="absolute left-0 right-0 bottom-0 z-40 transition-all duration-300 ease-in-out"
        style={{
          transform: bottomOpen ? 'translateY(0)' : 'translateY(calc(100% - 44px))',
        }}
      >
        <div className="w-full bg-gradient-to-r from-[#E8956A] to-[#D4724E] shadow-[0_-4px_20px_rgba(212,114,78,0.25)]">
          {/* 标题行：左侧标题 + 右侧收起按钮（不遮挡热线内容） */}
          <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/20">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-5 h-5 text-white shrink-0" />
              <span className="font-bold text-white text-base truncate">
                {selectedCity ? `${selectedCity} 心理援助热线` : 'SOS 紧急心理援助热线'}
              </span>
              {selectedCity && (
                <button
                  onClick={() => handleCityChange('')}
                  className="shrink-0 px-2 py-0.5 rounded text-xs text-white/80 hover:text-white hover:bg-white/20 transition-colors"
                  title="清除城市筛选，显示全国热线"
                >
                  切换全国
                </button>
              )}
            </div>
            <button
              onClick={() => setBottomOpen(!bottomOpen)}
              className="shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-lg text-white text-sm font-medium hover:bg-white/20 transition-colors"
            >
              {bottomOpen ? (
                <><span>收起热线</span><ArrowDown className="w-4 h-4" /></>
              ) : (
                <><Siren className="w-4 h-4" /><span>展开热线</span><ArrowUp className="w-4 h-4" /></>
              )}
            </button>
          </div>
          {/* 热线列表 - 收起按钮已移出，不再遮挡 */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 px-6 py-3">
            {displayHotlines.map((h, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-white/90 text-xs">{h.name}:</span>
                <a href={`tel:${h.hotline}`} className="text-white font-bold text-sm hover:underline">
                  {h.hotline}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ==================== 城市选择弹窗 ==================== */}
      <Modal
        title="选择城市"
        open={cityDialogVisible}
        onCancel={() => setCityDialogVisible(false)}
        footer={null}
        width={520}
        styles={{ body: { padding: '16px' } }}
      >
        <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
          <button
            onClick={() => { handleCityChange(''); setCityDialogVisible(false); }}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
              selectedCity === '' ? 'bg-[#C19A83] text-white border-[#C19A83] shadow-sm' : 'bg-[#F4EBE1] text-[#5C4D43] border-[#EADDD5] hover:bg-[#EADDD5]'
            }`}
          >全国</button>
          {allCitiesList.map(city => (
            <button
              key={city}
              onClick={() => { handleCityChange(city); setCityDialogVisible(false); }}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                selectedCity === city ? 'bg-[#C19A83] text-white border-[#C19A83] shadow-sm' : 'bg-[#F4EBE1] text-[#5C4D43] border-[#EADDD5] hover:bg-[#EADDD5]'
              }`}
            >
              {city}
            </button>
          ))}
        </div>
      </Modal>

      {/* ==================== 机构详情弹窗 ==================== */}
      {detailModalVisible && selectedInstitution && (
        <InstitutionDetailModal
          institution={selectedInstitution}
          onClose={() => { setDetailModalVisible(false); setSelectedInstitution(null); }}
        />
      )}

      {/* ==================== 热线详情弹窗 ==================== */}
      {hotlineModalVisible && selectedHotLine && (
        <HotLineModal
          hotline={selectedHotLine}
          onClose={() => { setHotlineModalVisible(false); setSelectedHotLine(null); }}
        />
      )}
    </div>
  );
}
