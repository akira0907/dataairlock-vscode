/**
 * PII検出エンジン
 * テキスト内のPIIをパターンマッチングで検出
 */

import { PIIType, PIIPattern, PIIMatch } from '../types';

/**
 * 生年月日検出のコンテキストキーワード
 * これらのキーワードが同じ行またはCSVヘッダーにある場合のみDOBを検出
 */
const DOB_CONTEXT_KEYWORDS = [
  '生年月日',
  '誕生日',
  '生まれ',
  '出生日',
  'DOB',
  'dob',
  'birthday',
  'birthdate',
  'birth_date',
  'date_of_birth',
  'dateOfBirth',
];

/**
 * NAME検出から除外する一般的な単語（日本語）
 * CSVのヘッダーや一般的なラベルを誤検出しないため
 */
const NAME_EXCLUSION_WORDS = [
  // CSVヘッダーによく使われる単語
  '生年月日', '誕生日', '電話番号', '住所', '氏名', '名前', '担当者',
  '作成日', '更新日', '登録日', '開始日', '終了日', '有効期限',
  '部署名', '所属', '職種', '役職', '確定', '未確定', '仮確定',
  // 医療関連
  '診断科', '診療科', '放射線', '内科', '外科', '整形外科',
  '小児科', '産婦人科', '皮膚科', '眼科', '耳鼻科', '泌尿器科',
  '精神科', '心療内科', '救急科', '麻酔科', '病理診断',
  // その他一般的な単語
  '当直', '日付', '時刻', '備考', '連絡先', '緊急連絡',
  '予定', '実績', '状態', '種別', '区分', '分類',
  // PIIキーワード等（誤検出を避ける）
  'マイナンバー', '個人番号', 'コメント',
];

/**
 * YAMLで名前を含む可能性が高いキー名（苗字単体の検出用）
 */
const YAML_NAME_KEYS = [
  'name', 'display_name', 'short_name', 'full_name',
  '氏名', '名前', '担当者', '姓', '名',
];

/**
 * PII検出クラス
 */
export class PIIDetector {
  private cachedHeaderContext: Map<string, boolean> = new Map();

  constructor(private patterns: PIIPattern[]) {}

  /**
   * テキスト内のPIIを検出
   * @param text 検出対象のテキスト
   * @returns 検出されたPIIマッチの配列（位置順にソート）
   */
  detect(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    // コンテキストベース検出用のヘッダー解析（CSV/TSV）
    const dobContextLines = this.analyzeDOBContext(text);

    // 優先度順にソート（低い数値が高優先）
    const sortedPatterns = [...this.patterns]
      .filter((p) => p.enabled || p.contextRequired)
      .sort((a, b) => a.priority - b.priority);

    for (const piiPattern of sortedPatterns) {
      // コンテキストベース検出のパターンで、有効でない場合はコンテキストチェックが必要
      const needsContextCheck = !piiPattern.enabled && piiPattern.contextRequired;

      for (const regex of piiPattern.patterns) {
        // グローバルフラグのある正規表現はlastIndexをリセット
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          const startIndex = match.index;
          const endIndex = startIndex + match[0].length;
          const matchedValue = match[0];

          // コンテキストベースの検出（DOBの場合）
          if (needsContextCheck && piiPattern.type === PIIType.DOB) {
            if (!this.hasDOBContext(text, startIndex, dobContextLines)) {
              continue;  // コンテキストがない場合はスキップ
            }
          }

          // NAME検出の場合、除外リストをチェック
          if (piiPattern.type === PIIType.NAME) {
            if (this.isExcludedName(matchedValue)) {
              continue;  // 一般的な単語はスキップ
            }
          }

          // 既存のマッチと重複しないかチェック
          if (!this.overlapsExisting(matches, startIndex, endIndex)) {
            matches.push({
              type: piiPattern.type,
              value: matchedValue,
              startIndex,
              endIndex,
            });
          }
        }
      }
    }

    // YAMLの名前フィールドを追加検出（苗字単体など短い名前）
    const yamlNameMatches = this.detectYamlNameFields(text, matches);
    matches.push(...yamlNameMatches);

    // 位置順にソート
    return matches.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * YAMLの名前関連フィールドから短い名前（苗字単体など）を検出
   */
  private detectYamlNameFields(text: string, existingMatches: PIIMatch[]): PIIMatch[] {
    const additionalMatches: PIIMatch[] = [];

    // YAMLの名前キーパターン: "key: value" または "key: 'value'" または 'key: "value"'
    for (const keyName of YAML_NAME_KEYS) {
      // キー名: 値 のパターン（引用符あり/なし）
      const patterns = [
        // block / flow map を想定して終端（#, EOL, 改行, カンマ, }）を許容
        new RegExp(`${keyName}:\\s*["']?([\\u4e00-\\u9faf]{2,4})["']?\\s*(?:#|$|\\n|,|\\})`, 'gi'),
        new RegExp(`${keyName}:\\s*["']?([ァ-ヶー]{2,6})["']?\\s*(?:#|$|\\n|,|\\})`, 'gi'),
      ];

      for (const regex of patterns) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          const value = match[1];
          const valueStart = match.index + match[0].indexOf(value);
          const valueEnd = valueStart + value.length;

          // 除外リストをチェック
          if (this.isExcludedName(value)) {
            continue;
          }

          // 既存のマッチと重複しないかチェック
          if (!this.overlapsExisting(existingMatches, valueStart, valueEnd) &&
              !this.overlapsExisting(additionalMatches, valueStart, valueEnd)) {
            additionalMatches.push({
              type: PIIType.NAME,
              value: value,
              startIndex: valueStart,
              endIndex: valueEnd,
            });
          }
        }
      }
    }

    return additionalMatches;
  }

  /**
   * DOBコンテキストを解析（CSV/TSVのヘッダーから生年月日列を特定）
   * @returns 生年月日コンテキストを持つ行番号のSet
   */
  private analyzeDOBContext(text: string): Set<number> {
    const contextLines = new Set<number>();
    const lines = text.split('\n');

    if (lines.length === 0) return contextLines;

    // ヘッダー行（最初の行）を解析
    const headerLine = lines[0];
    const isCSV = headerLine.includes(',');
    const isTSV = headerLine.includes('\t');

    if (isCSV || isTSV) {
      const delimiter = isCSV ? ',' : '\t';
      const headers = headerLine.split(delimiter);

      // 生年月日を含む列のインデックスを特定
      const dobColumnIndices: number[] = [];
      headers.forEach((header, index) => {
        const normalizedHeader = header.trim().toLowerCase();
        if (DOB_CONTEXT_KEYWORDS.some(keyword =>
          normalizedHeader.includes(keyword.toLowerCase())
        )) {
          dobColumnIndices.push(index);
        }
      });

      // 生年月日列がある場合、全行をコンテキストありとマーク
      if (dobColumnIndices.length > 0) {
        for (let i = 0; i < lines.length; i++) {
          contextLines.add(i);
        }
      }
    }

    return contextLines;
  }

  /**
   * マッチした名前が除外リストに含まれるかチェック
   */
  private isExcludedName(value: string): boolean {
    // 前後のクォートや空白を除去して比較
    const normalized = value.trim().replace(/^["「『]|["」』]$/g, '');
    return NAME_EXCLUSION_WORDS.includes(normalized);
  }

  /**
   * 指定位置にDOBコンテキストがあるかチェック
   */
  private hasDOBContext(text: string, position: number, contextLines: Set<number>): boolean {
    // 行番号を計算
    const lineNumber = text.substring(0, position).split('\n').length - 1;

    // CSV/TSVのヘッダーコンテキストがある場合
    if (contextLines.has(lineNumber)) {
      return true;
    }

    // 同じ行にキーワードがあるかチェック
    const lines = text.split('\n');
    if (lineNumber < lines.length) {
      const currentLine = lines[lineNumber];
      if (DOB_CONTEXT_KEYWORDS.some(keyword =>
        currentLine.toLowerCase().includes(keyword.toLowerCase())
      )) {
        return true;
      }
    }

    return false;
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
