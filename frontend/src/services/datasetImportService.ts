/**
 * VIS4SRD 数据集导入 API 服务
 * 
 * 提供数据集导入的完整API调用流程
 */

import axios from 'axios';

// API 基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * 数据集导入服务类
 */
export class DatasetImportService {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * 步骤1: 上传档案数据文件
   * 
   * @param file - CSV文件
   * @param dataSource - 数据来源标识
   * @returns 上传结果，包含 datasetKey, filePath, preview 等
   */
  async uploadArchive(file: File, dataSource: string = 'custom'): Promise<{
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
  }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('data_source', dataSource);

    console.log('📤 上传档案数据文件...', {
      fileName: file.name,
      fileSize: file.size,
      dataSource,
    });

    const response = await axios.post(
      `${this.baseURL}/api/upload/archive`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60秒超时
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            console.log(`📤 上传进度: ${percent}%`);
          }
        },
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.detail || '上传失败');
    }

    console.log('✅ 上传成功:', response.data.data);
    return response.data.data;
  }

  /**
   * 步骤2: 确认导入档案数据到数据库
   * 
   * @param datasetKey - 数据集标识
   * @param filePath - 文件路径
   * @param dataSource - 数据来源
   * @param acceptedRecords - 可选，接受的记录列表
   * @returns 导入结果
   */
  async confirmArchiveImport(
    datasetKey: string,
    filePath: string,
    dataSource: string = 'reddit',
    acceptedRecords?: string[]
  ): Promise<{
    success: boolean;
    message: string;
    datasetKey: string;
    batchCode: string;
    totalUsers: number;
    totalPosts: number;
    riskDistribution: Record<string, number>;
  }> {
    const payload = {
      datasetKey,
      filePath,
      dataSource,
      isManualAnnotation: false,
      ...(acceptedRecords && { acceptedRecords }),
    };

    console.log('💾 确认导入档案数据...', payload);

    const response = await axios.post(
      `${this.baseURL}/api/upload/archive/confirm`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 120000, // 120秒超时
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.detail || '导入失败');
    }

    console.log('✅ 导入成功:', response.data.data);
    return response.data.data;
  }

  /**
   * 完整导入流程（上传 + 确认）
   * 
   * @param file - CSV文件
   * @param dataSource - 数据来源
   * @param onProgress - 进度回调
   * @returns 导入结果
   */
  async importDataset(
    file: File,
    dataSource: string = 'custom',
    onProgress?: (step: 'upload' | 'confirm', progress: number) => void
  ): Promise<{
    datasetKey: string;
    batchCode: string;
    totalUsers: number;
    totalPosts: number;
    riskDistribution: Record<string, number>;
  }> {
    try {
      // 步骤1: 上传文件
      onProgress?.('upload', 0);
      const uploadResult = await this.uploadArchive(file, dataSource);
      onProgress?.('upload', 100);

      // 步骤2: 确认导入
      onProgress?.('confirm', 0);
      const confirmResult = await this.confirmArchiveImport(
        uploadResult.datasetKey,
        uploadResult.filePath,
        dataSource
      );
      onProgress?.('confirm', 100);

      return {
        datasetKey: confirmResult.datasetKey,
        batchCode: confirmResult.batchCode,
        totalUsers: confirmResult.totalUsers,
        totalPosts: confirmResult.totalPosts,
        riskDistribution: confirmResult.riskDistribution,
      };
    } catch (error) {
      console.error('❌ 导入失败:', error);
      throw error;
    }
  }

  /**
   * 获取已上传的数据集列表
   */
  async getUploadedDatasets(): Promise<Array<{
    fileName: string;
    filePath: string;
    fileSize: number;
    totalUsers?: number;
    totalPosts?: number;
    riskDistribution?: Record<string, number>;
    error?: string;
  }>> {
    const response = await axios.get(
      `${this.baseURL}/api/upload/archive/datasets`
    );
    return response.data.data || [];
  }

  /**
   * 删除已上传的数据集
   */
  async deleteUploadedDataset(fileName: string): Promise<boolean> {
    const response = await axios.delete(
      `${this.baseURL}/api/upload/archive/datasets/${fileName}`
    );
    return response.data.success;
  }
}

// 导出单例
export const datasetImportService = new DatasetImportService();

// ============================================================
// React Hook 示例
// ============================================================

/*
import { useState, useCallback } from 'react';
import { datasetImportService } from '@/services/datasetImportService';

interface ImportState {
  step: 'idle' | 'uploading' | 'confirming' | 'success' | 'error';
  progress: number;
  result?: {
    datasetKey: string;
    batchCode: string;
    totalUsers: number;
    totalPosts: number;
  };
  error?: string;
}

export function useDatasetImport() {
  const [state, setState] = useState<ImportState>({
    step: 'idle',
    progress: 0,
  });

  const importDataset = useCallback(async (file: File) => {
    setState({ step: 'uploading', progress: 0 });

    try {
      const result = await datasetImportService.importDataset(
        file,
        'custom',
        (step, progress) => {
          setState((prev) => ({
            ...prev,
            step: step === 'upload' ? 'uploading' : 'confirming',
            progress,
          }));
        }
      );

      setState({
        step: 'success',
        progress: 100,
        result,
      });

      return result;
    } catch (error: any) {
      setState({
        step: 'error',
        progress: 0,
        error: error.message || '导入失败',
      });
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ step: 'idle', progress: 0 });
  }, []);

  return { state, importDataset, reset };
}

// 使用示例:
// function ImportButton() {
//   const { state, importDataset, reset } = useDatasetImport();
//   const fileInputRef = useRef<HTMLInputElement>(null);
//
//   const handleImport = async () => {
//     const file = fileInputRef.current?.files?.[0];
//     if (!file) return;
//     await importDataset(file);
//   };
//
//   return (
//     <div>
//       <input type="file" accept=".csv" ref={fileInputRef} />
//       <button onClick={handleImport} disabled={state.step !== 'idle'}>
//         {state.step === 'idle' && '导入数据'}
//         {state.step === 'uploading' && `上传中... ${state.progress}%`}
//         {state.step === 'confirming' && `导入中... ${state.progress}%`}
//         {state.step === 'success' && '导入成功'}
//         {state.step === 'error' && '导入失败，点击重试'}
//       </button>
//       {state.result && (
//         <div>
//           <p>数据集: {state.result.datasetKey}</p>
//           <p>用户数: {state.result.totalUsers}</p>
//           <p>帖子数: {state.result.totalPosts}</p>
//         </div>
//       )}
//     </div>
//   );
// }
*/
