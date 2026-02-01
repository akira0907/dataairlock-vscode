/**
 * 匿名化エンジン
 * 検出されたPIIをプレースホルダーに置換
 */

import { PIIType, PIIMatch, MappingEntry, SessionMapping } from '../types';

/**
 * 匿名化クラス
 */
export class Anonymizer {
  /**
   * テキスト内のPIIをプレースホルダーに置換
   * @param text 対象テキスト
   * @param matches 検出されたPIIマッチ（位置順にソート済みであること）
   * @param mapping 既存のマッピング（重複防止用）
   * @param documentUri ドキュメントURI
   * @returns 置換後のテキストと新規マッピングエントリ
   */
  anonymize(
    text: string,
    matches: PIIMatch[],
    mapping: SessionMapping,
    documentUri: string
  ): { result: string; newEntries: MappingEntry[] } {
    const newEntries: MappingEntry[] = [];
    let result = text;
    let offset = 0;

    for (const match of matches) {
      // 既にマッピングされているか確認（同じ値は同じプレースホルダーを使用）
      let placeholder = mapping.reverseIndex.get(match.value);

      if (!placeholder) {
        // 新しいプレースホルダーを生成
        placeholder = this.generatePlaceholder(match.type, mapping);

        // 新規エントリを記録
        newEntries.push({
          placeholder,
          original: match.value,
          type: match.type,
          documentUri,
          createdAt: Date.now(),
        });
      }

      // テキスト内で置換（オフセットを考慮）
      const adjustedStart = match.startIndex + offset;
      result =
        result.slice(0, adjustedStart) +
        placeholder +
        result.slice(adjustedStart + match.value.length);

      // オフセットを更新（プレースホルダーの長さ - 元の値の長さ）
      offset += placeholder.length - match.value.length;
    }

    return { result, newEntries };
  }

  /**
   * プレースホルダーを生成
   * 形式: [TYPE_NNN] (例: [NAME_001], [PHONE_002])
   */
  private generatePlaceholder(
    type: PIIType,
    mapping: SessionMapping
  ): string {
    // 現在のカウンターを取得（なければ0）
    const currentCounter = mapping.counters.get(type) || 0;
    const newCounter = currentCounter + 1;

    // カウンターを更新
    mapping.counters.set(type, newCounter);

    // 3桁のゼロパディング
    const paddedCounter = newCounter.toString().padStart(3, '0');
    return `[${type}_${paddedCounter}]`;
  }

  /**
   * 単一の値を匿名化（テスト用ユーティリティ）
   */
  anonymizeSingleValue(
    value: string,
    type: PIIType,
    mapping: SessionMapping,
    documentUri: string
  ): { placeholder: string; entry: MappingEntry | null } {
    // 既存のマッピングをチェック
    const existingPlaceholder = mapping.reverseIndex.get(value);
    if (existingPlaceholder) {
      return { placeholder: existingPlaceholder, entry: null };
    }

    // 新しいプレースホルダーを生成
    const placeholder = this.generatePlaceholder(type, mapping);
    const entry: MappingEntry = {
      placeholder,
      original: value,
      type,
      documentUri,
      createdAt: Date.now(),
    };

    return { placeholder, entry };
  }
}
