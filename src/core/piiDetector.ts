/**
 * PII検出エンジン
 * テキスト内のPIIをパターンマッチングで検出
 */

import { PIIType, PIIPattern, PIIMatch } from '../types';

/**
 * PII検出クラス
 */
export class PIIDetector {
  constructor(private patterns: PIIPattern[]) {}

  /**
   * テキスト内のPIIを検出
   * @param text 検出対象のテキスト
   * @returns 検出されたPIIマッチの配列（位置順にソート）
   */
  detect(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    // 優先度順にソート（低い数値が高優先）
    const sortedPatterns = [...this.patterns]
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const piiPattern of sortedPatterns) {
      for (const regex of piiPattern.patterns) {
        // グローバルフラグのある正規表現はlastIndexをリセット
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          const startIndex = match.index;
          const endIndex = startIndex + match[0].length;

          // 既存のマッチと重複しないかチェック
          if (!this.overlapsExisting(matches, startIndex, endIndex)) {
            matches.push({
              type: piiPattern.type,
              value: match[0],
              startIndex,
              endIndex,
            });
          }
        }
      }
    }

    // 位置順にソート
    return matches.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * 指定された範囲が既存のマッチと重複するかチェック
   */
  private overlapsExisting(
    matches: PIIMatch[],
    start: number,
    end: number
  ): boolean {
    return matches.some((m) => !(end <= m.startIndex || start >= m.endIndex));
  }

  /**
   * パターンを更新
   */
  updatePatterns(patterns: PIIPattern[]): void {
    this.patterns = patterns;
  }

  /**
   * 特定のPII種別のみを検出
   */
  detectByType(text: string, type: PIIType): PIIMatch[] {
    const filteredPatterns = this.patterns.filter(
      (p) => p.type === type && p.enabled
    );
    const detector = new PIIDetector(filteredPatterns);
    return detector.detect(text);
  }

  /**
   * テキスト内にPIIが含まれるかどうかを高速チェック
   * （完全な検出は行わず、存在確認のみ）
   */
  containsPII(text: string): boolean {
    for (const piiPattern of this.patterns) {
      if (!piiPattern.enabled) continue;
      for (const regex of piiPattern.patterns) {
        regex.lastIndex = 0;
        if (regex.test(text)) {
          return true;
        }
      }
    }
    return false;
  }
}
