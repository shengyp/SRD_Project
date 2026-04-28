import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { fetchHomeTrend, HomeTrend } from '../api';

export default function TrendChart() {
  const [trendData, setTrendData] = useState<HomeTrend[]>([]);

  useEffect(() => {
    fetchHomeTrend()
      .then((data) => {
        if (data && data.length > 0) {
          setTrendData(data);
        }
      })
      .catch(console.error);
  }, []);

  if (trendData.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        暂无趋势数据
      </div>
    );
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      textStyle: {
        color: '#4a3b32',
        fontSize: 12,
      },
    },
    legend: {
      data: ['量表评估', '风险检测', '低风险', '中风险', '高风险'],
      bottom: 0,
      textStyle: {
        color: '#6b5b52',
        fontSize: 11,
      },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '18%',
      top: '8%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendData.map((item) => item.date),
      axisLine: {
        lineStyle: {
          color: '#e5e7eb',
        },
      },
      axisLabel: {
        color: '#8c7a6b',
        fontSize: 10,
        rotate: 30,
      },
      axisTick: {
        show: false,
      },
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false,
      },
      axisLabel: {
        color: '#8c7a6b',
        fontSize: 10,
      },
      splitLine: {
        lineStyle: {
          color: '#f2e8e0',
          type: 'dashed',
        },
      },
    },
    series: [
      {
        name: '量表评估',
        type: 'line',
        smooth: true,
        data: trendData.map((item) => item.scaleCount),
        lineStyle: {
          color: '#f97316',
          width: 2,
        },
        itemStyle: {
          color: '#f97316',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(249, 115, 22, 0.2)' },
              { offset: 1, color: 'rgba(249, 115, 22, 0)' },
            ],
          },
        },
      },
      {
        name: '风险检测',
        type: 'line',
        smooth: true,
        data: trendData.map((item) => item.detectionCount),
        lineStyle: {
          color: '#3b82f6',
          width: 2,
        },
        itemStyle: {
          color: '#3b82f6',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.15)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0)' },
            ],
          },
        },
      },
      {
        name: '低风险',
        type: 'bar',
        stack: 'risk',
        data: trendData.map((item) => item.riskLow),
        itemStyle: {
          color: '#22c55e',
        },
        barWidth: '60%',
      },
      {
        name: '中风险',
        type: 'bar',
        stack: 'risk',
        data: trendData.map((item) => item.riskMedium),
        itemStyle: {
          color: '#eab308',
        },
      },
      {
        name: '高风险',
        type: 'bar',
        stack: 'risk',
        data: trendData.map((item) => item.riskHigh),
        itemStyle: {
          color: '#ef4444',
        },
      },
    ],
  };

  return (
    <div className="flex-1 w-full min-h-[200px]">
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%', minHeight: '200px' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
