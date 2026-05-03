import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchCityCoordinates } from '../api';

// ==================== 高德地图全局类型声明 ====================
declare global {
  interface Window {
    AMap: typeof AMap;
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
    showInstitutionDetail?: (id: string) => void;
  }
}

// AMap 类型声明
declare namespace AMap {
  class Map {
    constructor(container: string | HTMLDivElement, options?: Record<string, unknown>);
    add(obj: unknown): void;
    remove(obj: unknown): void;
    setCenter(lnglat: [number, number] | LngLat): void;
    setZoom(zoom: number): void;
    setFitView(markers: unknown[], avoid?: boolean, maxZoom?: number[], zoomLimit?: number): void;
    getCenter(): LngLat;
    getZoom(): number;
    setLimitBounds(bounds: Bounds): void;
    plugin(plugins: string | string[], callback: () => void): void;
    addControl(control: unknown): void;
    destroy(): void;
  }
  class Marker {
    constructor(options?: Record<string, unknown>);
    setPosition(lnglat: LngLat | [number, number]): void;
    getPosition(): LngLat;
    setContent(content: string | HTMLDivElement): void;
    setExtData(data: unknown): void;
    getExtData(): unknown;
    on(event: string, handler: (e: MarkerEvent) => void): void;
  }
  class InfoWindow {
    constructor(options?: Record<string, unknown>);
    setContent(content: string | HTMLDivElement): void;
    open(map: Map, position: LngLat | [number, number]): void;
    close(): void;
  }
  class Circle {
    constructor(options?: Record<string, unknown>);
  }
  class Scale {}
  class ToolBar {}
  class Geolocation {
    constructor(options?: Record<string, unknown>);
    getCurrentPosition(callback: (status: string, result: GeolocationResult) => void): void;
  }
  class Geocoder {
    getAddress(lnglat: LngLat | [number, number], callback: (status: string, result: GeocoderResult) => void): void;
  }
  class CitySearch {
    constructor();
    getLocalCity(callback: (status: string, result: CitySearchResult) => void): void;
  }
  class MarkerClusterer {
    constructor(map: Map, markers?: unknown[], options?: Record<string, unknown>);
    setMap(map: Map | null): void;
    setData(data: { lnglat: LngLat; marker: Marker }[]): void;
  }
  class LngLat {
    constructor(lng: number, lat: number);
    lng: number;
    lat: number;
  }
  class Bounds {
    constructor(sw: LngLat, ne: LngLat);
  }
  class Pixel {
    constructor(x: number, y: number);
  }
  interface MarkerEvent {
    target: Marker;
  }
  interface GeolocationResult {
    position: { lng: number; lat: number };
    formattedAddress?: string;
    addressComponent?: {
      province?: string;
      city?: string;
      district?: string;
      township?: string;
    };
    city?: string;
    address?: string;
  }
  interface GeocoderResult {
    regeocode?: {
      formattedAddress: string;
      addressComponent: {
        province: string;
        city: string;
        district: string;
      };
    };
  }
  interface CitySearchResult {
    city?: string;
    province?: string;
  }
}

// ==================== 工具函数 ====================
function getDistanceMeters( lat1: number, lng1: number, lat2: number, lng2: number ): number {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance( meters: number ): string {
  if (meters === undefined || meters === null ) return '';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + 'km' : `${Math.round(meters)}m`;
}

  // 城市坐标映射（从后端 API 加载，fallback 到默认坐标）
let cityCoordsCache: Record<string, [number, number]> = {};

// 默认城市坐标（fallback）
const DEFAULT_CITY_COORDS: Record<string, [number, number]> = {
  '北京市': [116.4074, 39.9042], '上海市': [121.4737, 31.2304],
  '广州市': [113.2644, 23.1291], '深圳市': [114.3055, 22.5431],
  '成都市': [104.0665, 30.5728], '武汉市': [114.3055, 30.5928],
  '西安市': [108.9543, 34.3416], '南京市': [118.7969, 32.0603],
  '杭州市': [120.1536, 30.2744], '重庆市': [106.5516, 29.5630],
  '天津市': [117.2008, 39.1356], '苏州市': [120.5853, 31.2989],
  '郑州市': [113.6253, 34.7466],
};

// 获取城市坐标（优先用缓存的 API 数据，否则用默认坐标）
function getCityCoords(city: string): [number, number] {
  return cityCoordsCache[city] || DEFAULT_CITY_COORDS[city] || [106.5516, 29.5630];
}

// 加载城市坐标数据（从后端 API）
async function loadCityCoordsFromApi(): Promise<void> {
  try {
    const data = await fetchCityCoordinates();
    if (data && typeof data === 'object') {
      cityCoordsCache = data as Record<string, [number, number]>;
    }
  } catch {
    // 使用默认缓存
  }
}

// ==================== Hook ====================
export interface GaodeMapInstance {
  map: AMap.Map | null;
  loading: boolean;
  userLocation: { lat: number; lng: number } | null;
  userCity: string;
  userDistrict: string;
  userAddress: string;
  locating: boolean;
  mapError: string | null;
  locateUser: () => void;
  focusInstitution: (inst: { longitude?: number; latitude?: number; name: string }) => void;
  clearMarkers: () => void;
}

export function useGaodeMap(
  containerId: string,
  onInstitutionClick?: (id: string) => void,
) {
  const mapRef = useRef<AMap.Map | null>(null);
  const markersRef = useRef<AMap.Marker[]>([]);
  const clusterRef = useRef<AMap.MarkerClusterer | null>(null);
  const infoWindowRef = useRef<AMap.InfoWindow | null>(null);
  const radiusCircleRef = useRef<AMap.Circle | null>(null);
  const userMarkerRef = useRef<AMap.Marker | null>(null);

  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState('');
  const [userDistrict, setUserDistrict] = useState('');
  const [userAddress, setUserAddress] = useState('');

  // 加载高德地图 JS SDK
  const loadAMapScript = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      if (window.AMap) { resolve(); return; }

      const key = import.meta.env.VITE_AMAP_JS_KEY || '';
      const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE || '';

      // 设置安全密钥
      if (securityCode) {
        window._AMapSecurityConfig = { securityJsCode: securityCode };
      }

      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Scale,AMap.ToolBar,AMap.Geolocation,AMap.Circle,AMap.Geocoder,AMap.CitySearch,AMap.MarkerClusterer`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('高德地图 SDK 加载失败'));
      document.head.appendChild(script);
    });
  }, []);

  // 初始化地图
  useEffect(() => {
    let mounted = true;

    async function initMap() {
      try {
        setLoading(true);
        setMapError(null);
        await loadAMapScript();

        if (!mounted) return;

        // 等待 DOM 就绪
        await new Promise<void>(resolve => {
          const check = () => {
            const el = document.getElementById(containerId);
            if (el) resolve();
            else setTimeout(check, 50);
          };
          check();
        });

        if (!mounted) return;

        const map = new window.AMap.Map(containerId, {
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

        mapRef.current = map;

        // 创建信息窗口
        infoWindowRef.current = new window.AMap.InfoWindow({
          offset: new window.AMap.Pixel(0, -30),
        });

        // 限制地图可视范围为中国境内
        map.plugin(['AMap.Scale', 'AMap.ToolBar', 'AMap.Geolocation', 'AMap.Circle', 'AMap.Geocoder', 'AMap.CitySearch', 'AMap.MarkerClusterer'], () => {
          if (!mounted) return;
          map.addControl(new window.AMap.Scale());
          map.setLimitBounds(new window.AMap.Bounds(
            new window.AMap.LngLat(73.33, 3.52),
            new window.AMap.LngLat(135.05, 53.55),
          ));
        });

        // 注册全局详情回调
        window.showInstitutionDetail = (id: string) => {
          if (onInstitutionClick) onInstitutionClick(id);
        };

        // IP 城市快速定位
        getIPCity(map);

        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        console.error('地图初始化失败:', err);
        setMapError('地图加载失败，请检查网络连接');
        setLoading(false);
      }
    }

    initMap();

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [containerId, loadAMapScript, onInstitutionClick]);

  // IP 城市定位
  const getIPCity = (_map: AMap.Map) => {
    (window.AMap as any).plugin(['AMap.CitySearch'], () => {
      const citySearch = new window.AMap.CitySearch();
      citySearch.getLocalCity((status: string, result: AMap.CitySearchResult) => {
        if (status === 'complete' && result.city) {
          setUserCity(result.city || '');
          setUserAddress(result.city || '');
          if (!userCity) {
            // 首次自动选中当前城市
          }
        }
      });
    });
  };

  // 用户定位
  const locateUser = useCallback(() => {
    if (!mapRef.current) return;
    setLocating(true);

    (window.AMap as any).plugin(['AMap.Geolocation', 'AMap.Geocoder'], () => {
      const geo = new window.AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
        GeoLocationFirst: false,
        noIpLocate: 0,
        noGeoLocation: 0,
        needAddress: true,
        buttonHideOffsetX: 9999,
        buttonHideOffsetY: 9999,
      });

      geo.getCurrentPosition((status: string, result: AMap.GeolocationResult) => {
        if (status === 'complete') {
          const lng = result.position.lng;
          const lat = result.position.lat;
          const loc = { lat, lng };
          setUserLocation(loc);

          const ac = result.addressComponent || {};
          const addr = result.formattedAddress || '';
          const city = ac.city || ac.province || result.city || '重庆市';
          const district = ac.district || ac.township || '';

          setUserCity(city);
          setUserDistrict(district);
          setUserAddress(addr);

          if (mapRef.current) {
            mapRef.current.setCenter([lng, lat]);
            mapRef.current.setZoom(16);

            if (userMarkerRef.current) mapRef.current.remove(userMarkerRef.current);
            userMarkerRef.current = new window.AMap.Marker({
              position: [lng, lat],
              content: '<div style="width:14px;height:14px;background:#2F6BFF;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(47,107,255,0.18)"></div>',
              offset: new window.AMap.Pixel(-7, -7),
              zIndex: 200,
            });
            mapRef.current.add(userMarkerRef.current);
          }
          setLocating(false);
        } else {
          setLocating(false);
        }
      });
    });
  }, []);

  // 聚焦机构
  const focusInstitution = useCallback((inst: { longitude?: number; latitude?: number; name: string }) => {
    if (!mapRef.current || !inst.longitude || !inst.latitude) return;
    mapRef.current.setCenter([inst.longitude, inst.latitude]);
    mapRef.current.setZoom(17);
    setTimeout(() => showMarkerInfo(inst), 300);
  }, []);

  // 显示标记信息
  const showMarkerInfo = useCallback((inst: { longitude?: number; latitude?: number; name: string; type?: string; address?: string; phone?: string; rating?: number; id?: string }) => {
    if (!mapRef.current || !infoWindowRef.current) return;
    const content = `
      <div style="padding:10px;min-width:200px;border-radius:12px;border:1px solid #DCE7F5;background:white;box-shadow:0 10px 24px rgba(15,23,42,0.08);">
        <h4 style="margin:0 0 8px;color:#162033;font-size:14px;font-weight:600;">${inst.name}</h4>
        <p style="margin:4px 0;color:#64748B;font-size:12px;">🏥 ${inst.type || '未知类型'}</p>
        <p style="margin:4px 0;color:#64748B;font-size:12px;">📍 ${inst.address || '暂无地址'}</p>
        <p style="margin:4px 0;color:#64748B;font-size:12px;">📞 ${inst.phone || '暂无电话'}</p>
        ${inst.rating ? `<p style="margin:4px 0;color:#2F6BFF;font-size:12px;">⭐ ${inst.rating}/5.0</p>` : ''}
        <button
          onclick="window.showInstitutionDetail('${inst.id}')"
          style="margin-top:8px;padding:4px 12px;background:#2F6BFF;color:white;border:none;border-radius:8px;cursor:pointer;font-size:12px;"
        >查看详情</button>
      </div>
    `;
    infoWindowRef.current.setContent(content);
    infoWindowRef.current.open(mapRef.current, [inst.longitude!, inst.latitude!]);
  }, []);

  // 清除标记
  const clearMarkers = useCallback(() => {
    if (!mapRef.current) return;
    if (clusterRef.current) { clusterRef.current.setMap(null); clusterRef.current = null; }
    markersRef.current.forEach(m => mapRef.current!.remove(m));
    markersRef.current = [];
  }, []);

  // 更新标记（对外暴露）
  const updateMarkers = useCallback((institutionList: Array<{
    id: string;
    name: string;
    type?: string;
    address?: string;
    phone?: string;
    rating?: number;
    longitude?: number;
    latitude?: number;
  }>, selectedCity: string) => {
    if (!mapRef.current) return;
    clearMarkers();

    institutionList.forEach(inst => {
      if (!inst.longitude || !inst.latitude) return;

      const markerContent = document.createElement('div');
      markerContent.className = 'custom-marker';
      markerContent.innerHTML = `<div class="marker-icon ${inst.type || ''}"><span>🏥</span></div>`;

      const style = document.createElement('style');
      style.textContent = `
        .custom-marker { cursor: pointer; }
        .marker-icon {
          width:32px;height:32px;background:linear-gradient(135deg,#5B8CFF,#2F6BFF);
          border-radius:50% 50% 50% 0;transform:rotate(-45deg);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 8px rgba(47,107,255,0.28);transition:all 0.3s;
        }
        .marker-icon:hover { transform:rotate(-45deg) scale(1.1); }
        .marker-icon span { transform:rotate(45deg);font-size:14px; }
        .marker-icon.精神专科医院 { background:linear-gradient(135deg,#e74c3c,#c0392b); }
        .marker-icon.心理咨询中心 { background:linear-gradient(135deg,#9b59b6,#8e44ad); }
        .marker-icon.危机干预中心 { background:linear-gradient(135deg,#e67e22,#d35400); }
      `;
      if (!document.getElementById('marker-styles')) { style.id = 'marker-styles'; document.head.appendChild(style); }

      const marker = new window.AMap.Marker({
        position: [inst.longitude, inst.latitude],
        content: markerContent,
        offset: new window.AMap.Pixel(-16, -32),
        extData: inst,
      });

      marker.on('click', () => showMarkerInfo({ ...inst, longitude: inst.longitude!, latitude: inst.latitude! }));
      marker.on('mouseover', () => {
        (markerContent.querySelector('.marker-icon') as HTMLElement).style.transform = 'rotate(-45deg) scale(1.1)';
      });
      marker.on('mouseout', () => {
        (markerContent.querySelector('.marker-icon') as HTMLElement).style.transform = 'rotate(-45deg) scale(1)';
      });

      markersRef.current.push(marker);
    });

    const useCluster = selectedCity === '' && markersRef.current.length > 100;

    if (useCluster) {
      clusterRef.current = new window.AMap.MarkerClusterer(mapRef.current, [], {
        gridSize: 80,
      });
      const data = markersRef.current.map(m => ({
        lnglat: m.getPosition(),
        marker: m,
      }));
      clusterRef.current.setData(data);
    } else {
      markersRef.current.forEach(m => mapRef.current!.add(m));
    }

    // 自动调整视野
    if (markersRef.current.length > 0 && !userLocation) {
      if (markersRef.current.length === 1 && institutionList[0]) {
        mapRef.current.setCenter([institutionList[0].longitude!, institutionList[0].latitude!]);
        mapRef.current.setZoom(14);
      } else {
        mapRef.current.setFitView(markersRef.current, false, [50, 50, 50, 50], 15);
      }
    }
  }, [clearMarkers, showMarkerInfo, userLocation]);

  // 更新半径圆
  const updateRadiusCircle = useCallback((radiusMeters: number) => {
    if (!mapRef.current || !userLocation) return;
    if (radiusCircleRef.current) { mapRef.current.remove(radiusCircleRef.current); radiusCircleRef.current = null; }
    if (!isFinite(radiusMeters)) return;
    radiusCircleRef.current = new window.AMap.Circle({
      center: [userLocation.lng, userLocation.lat],
      radius: radiusMeters,
      strokeColor: '#2F6BFF',
      strokeWeight: 2,
      strokeOpacity: 0.8,
      fillColor: '#2F6BFF',
      fillOpacity: 0.08,
      zIndex: 10,
    });
    mapRef.current.add(radiusCircleRef.current);
  }, [userLocation]);

  // 城市定位
  const fitMapToCity = useCallback((city: string) => {
    if (!mapRef.current) return;
    const coords = getCityCoords(city);
    mapRef.current.setCenter(coords);
    mapRef.current.setZoom(12);
  }, []);

  // 初始化时加载城市坐标
  useEffect(() => {
    loadCityCoordsFromApi();
  }, []);

  return {
    map: mapRef.current,
    loading,
    userLocation,
    userCity,
    userDistrict,
    userAddress,
    locating,
    mapError,
    locateUser,
    focusInstitution,
    clearMarkers,
    updateMarkers,
    updateRadiusCircle,
    fitMapToCity,
    getDistanceMeters,
    formatDistance,
    getCityCoords,
  };
}

export type { };
