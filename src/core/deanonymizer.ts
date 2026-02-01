/**
 * 復元エンジン
 * プレースホルダーを元の値に復元
 */

import { SessionMapping } from '../types';

/**
 * プレースホルダー検出用の正規表現
 * 形式: [TYPE_NNN] (例: [NAME_001], [PHONE_002])
 */
const PLACEHOLDER_REGEX =
  /\[(NAME|PHONE|EMAIL|ADDRESS|MYNUMBER|DOB)_\d{3}\]/g;

/**
 * プレースホルダー情報
 */
export interface PlaceholderInfo {
  /** プレースホルダー文字列 */
  placeholder: string;
  /** テキスト内の開始位置 */
  start: number;
  /** テキスト内の終了位置（exclusive） */
  end: number;
}

/**
 * 復元クラス
 */
export class Deanonymizer {
  /**
   * テキスト内のプレースホルダーを元の値に復元
   * @param text 対象テキスト
   * @param mapping マッピング情報
   * @returns 復元後のテキスト
   */
  deanonymize(text: string, mapping: SessionMapping): string {
    return text.replace(PLACEHOLDER_REGEX, (placeholder) => {
      const entry = mapping.entries.get(placeholder);
      // マッピングが見つかれば元の値を返す、なければプレースホルダーのまま
      return entry ? entry.original : placeholder;
    });
  }

  /**
   * テキスト内のプレースホルダーを検出
   * @param text 対象テキスト
   * @returns プレースホルダー情報の配列
   */
  findPlaceholders(text: string): PlaceholderInfo[] {
    const results: PlaceholderInfo[] = [];
    // 正規表現をリセット
    PLACEHOLDER_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
      results.push({
        placeholder: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return results;
  }

  /**
   * テキスト内にプレースホルダーが含まれるかチェック
   */
  containsPlaceholders(text: string): boolean {
    PLACEHOLDER_REGEX.lastIndex = 0;
    return PLACEHOLDER_REGEX.test(text);
  }

  /**
   * マッピングから復元可能なプレースホルダーの数を取得
   */
  countRestorablePlaceholders(text: string, mapping: SessionMapping): number {
    const placeholders = this.findPlaceholders(text);
    return placeholders.filter((p) =>
      mapping.entries.has(p.placeholder)
    ).length;
  }

  /**
   * 部分的な復元（特定のプレースホルダーのみ）
   */
  deanonymizePartial(
    text: string,
    mapping: SessionMapping,
    placeholdersToRestore: string[]
  ): string {
    const restoreSet = new Set(placeholdersToRestore);
    return text.replace(PLACEHOLDER_REGEX, (placeholder) => {
      if (!restoreSet.has(placeholder)) {
        return placeholder;
      }
      const entry = mapping.entries.get(placeholder);
      return entry ? entry.original : placeholder;
    });
  }
}
