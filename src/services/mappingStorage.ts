/**
 * マッピングのファイル保存・読み込み
 * JSONファイルとしてマッピングを永続化
 */

import * as fs from 'fs';
import * as path from 'path';
import { MappingEntry, PIIType, SessionMapping } from '../types';

/**
 * JSONファイルに保存するマッピング形式
 */
interface StoredMapping {
  version: string;
  createdAt: string;
  updatedAt: string;
  sourceFolder: string;
  outputFolder: string;
  entries: StoredMappingEntry[];
}

interface StoredMappingEntry {
  placeholder: string;
  original: string;
  type: string;
  sourceFile: string;
}

/**
 * マッピングストレージクラス
 */
export class MappingStorage {
  private static readonly MAPPING_FILENAME = 'mapping.json';
  private static readonly VERSION = '1.0.0';

  /**
   * マッピングをJSONファイルに保存
   */
  static async saveMapping(
    outputFolder: string,
    sourceFolder: string,
    mapping: SessionMapping
  ): Promise<string> {
    const mappingPath = path.join(outputFolder, this.MAPPING_FILENAME);

    const storedMapping: StoredMapping = {
      version: this.VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFolder,
      outputFolder,
      entries: Array.from(mapping.entries.values()).map((entry) => ({
        placeholder: entry.placeholder,
        original: entry.original,
        type: entry.type,
        sourceFile: entry.documentUri,
      })),
    };

    await fs.promises.writeFile(
      mappingPath,
      JSON.stringify(storedMapping, null, 2),
      'utf-8'
    );

    return mappingPath;
  }

  /**
   * JSONファイルからマッピングを読み込み
   */
  static async loadMapping(mappingPath: string): Promise<SessionMapping> {
    const content = await fs.promises.readFile(mappingPath, 'utf-8');
    const storedMapping: StoredMapping = JSON.parse(content);

    const mapping: SessionMapping = {
      entries: new Map(),
      reverseIndex: new Map(),
      counters: new Map(),
    };

    // カウンターを初期化
    for (const type of Object.values(PIIType)) {
      mapping.counters.set(type, 0);
    }

    // エントリを復元
    for (const stored of storedMapping.entries) {
      const entry: MappingEntry = {
        placeholder: stored.placeholder,
        original: stored.original,
        type: stored.type as PIIType,
        documentUri: stored.sourceFile,
        createdAt: Date.now(),
      };

      mapping.entries.set(entry.placeholder, entry);
      mapping.reverseIndex.set(entry.original, entry.placeholder);

      // カウンターを更新（プレースホルダーから番号を抽出）
      const match = stored.placeholder.match(/\[([A-Z]+)_(\d+)\]/);
      if (match) {
        const type = match[1] as PIIType;
        const num = parseInt(match[2], 10);
        const currentMax = mapping.counters.get(type) || 0;
        if (num > currentMax) {
          mapping.counters.set(type, num);
        }
      }
    }

    return mapping;
  }

  /**
   * マッピングファイルが存在するか確認
   */
  static async mappingExists(folderPath: string): Promise<boolean> {
    const mappingPath = path.join(folderPath, this.MAPPING_FILENAME);
    try {
      await fs.promises.access(mappingPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * マッピングファイルのパスを取得
   */
  static getMappingPath(folderPath: string): string {
    return path.join(folderPath, this.MAPPING_FILENAME);
  }
}
