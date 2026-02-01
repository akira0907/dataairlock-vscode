/**
 * マッピング管理サービス
 * セッション内のPII匿名化マッピングを管理
 */

import * as vscode from 'vscode';
import {
  PIIType,
  MappingEntry,
  SessionMapping,
  MappingStats,
} from '../types';

/**
 * マッピング管理クラス
 * メモリ内でマッピングを管理（ファイル永続化なし）
 */
export class MappingService implements vscode.Disposable {
  private sessionMapping: SessionMapping;

  /** マッピング変更時のイベント */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.sessionMapping = this.createEmptyMapping();
  }

  /**
   * 空のマッピングを作成
   */
  private createEmptyMapping(): SessionMapping {
    return {
      entries: new Map(),
      reverseIndex: new Map(),
      counters: new Map(),
    };
  }

  /**
   * マッピングエントリを追加
   */
  addEntries(entries: MappingEntry[]): void {
    for (const entry of entries) {
      this.sessionMapping.entries.set(entry.placeholder, entry);
      this.sessionMapping.reverseIndex.set(entry.original, entry.placeholder);
    }
    this._onDidChange.fire();
  }

  /**
   * 現在のマッピングを取得
   */
  getMapping(): SessionMapping {
    return this.sessionMapping;
  }

  /**
   * プレースホルダーからエントリを取得
   */
  getEntryByPlaceholder(placeholder: string): MappingEntry | undefined {
    return this.sessionMapping.entries.get(placeholder);
  }

  /**
   * 元の値からプレースホルダーを取得
   */
  getPlaceholderByOriginal(original: string): string | undefined {
    return this.sessionMapping.reverseIndex.get(original);
  }

  /**
   * 全エントリを取得
   */
  getAllEntries(): MappingEntry[] {
    return Array.from(this.sessionMapping.entries.values());
  }

  /**
   * 特定のPII種別のエントリを取得
   */
  getEntriesByType(type: PIIType): MappingEntry[] {
    return this.getAllEntries().filter((e) => e.type === type);
  }

  /**
   * 特定のドキュメントに関連するエントリを取得
   */
  getEntriesByDocument(documentUri: string): MappingEntry[] {
    return this.getAllEntries().filter((e) => e.documentUri === documentUri);
  }

  /**
   * マッピング統計を取得
   */
  getStats(): MappingStats {
    const entries = this.getAllEntries();
    const byType = {} as Record<PIIType, number>;

    // 各種別のカウントを初期化
    for (const type of Object.values(PIIType)) {
      byType[type] = 0;
    }

    // カウント
    for (const entry of entries) {
      byType[entry.type]++;
    }

    return {
      total: entries.length,
      byType,
    };
  }

  /**
   * 特定のエントリを削除
   */
  removeEntry(placeholder: string): boolean {
    const entry = this.sessionMapping.entries.get(placeholder);
    if (!entry) {
      return false;
    }

    this.sessionMapping.entries.delete(placeholder);
    this.sessionMapping.reverseIndex.delete(entry.original);
    this._onDidChange.fire();
    return true;
  }

  /**
   * 全マッピングをクリア
   */
  clear(): void {
    this.sessionMapping = this.createEmptyMapping();
    this._onDidChange.fire();
  }

  /**
   * マッピングが空かどうか
   */
  isEmpty(): boolean {
    return this.sessionMapping.entries.size === 0;
  }

  /**
   * エントリ数を取得
   */
  getCount(): number {
    return this.sessionMapping.entries.size;
  }

  /**
   * リソース解放
   */
  dispose(): void {
    this._onDidChange.dispose();
    this.clear();
  }
}
