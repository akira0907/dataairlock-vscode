/**
 * PII検出パターンの定義とレジストリ
 * DataAirlock Pythonコードベースから移植した日本語PIIパターン
 */

import { PIIType, PIIPattern } from '../types';

/**
 * デフォルトのPII検出パターン
 * 優先度（priority）: 低い数値ほど高優先度で先にマッチ
 * 汎用的なパターン（氏名など）は低優先度に設定
 */
export const DEFAULT_PATTERNS: PIIPattern[] = [
  // 電話番号 (優先度: 10)
  {
    type: PIIType.PHONE,
    patterns: [
      // 固定電話（ハイフンあり）: 03-1234-5678, 06-1234-5678
      /0\d{1,4}-\d{1,4}-\d{4}/g,
      // 携帯電話（ハイフンあり）: 090-1234-5678, 080-1234-5678, 070-1234-5678
      /0[789]0-\d{4}-\d{4}/g,
      // 電話番号（ハイフンなし）: 09012345678, 0312345678
      /0\d{9,10}/g,
    ],
    enabled: true,
    priority: 10,
  },

  // メールアドレス (優先度: 20)
  {
    type: PIIType.EMAIL,
    patterns: [
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    ],
    enabled: true,
    priority: 20,
  },

  // マイナンバー (優先度: 30)
  {
    type: PIIType.MYNUMBER,
    patterns: [
      // ハイフン/スペース区切り: 1234-5678-9012, 1234 5678 9012
      /\b\d{4}[ -]\d{4}[ -]\d{4}\b/g,
      // 連続12桁: 123456789012
      /\b\d{12}\b/g,
    ],
    enabled: true,
    priority: 30,
  },

  // 生年月日 (優先度: 40)
  {
    type: PIIType.DOB,
    patterns: [
      // 西暦（スラッシュ/ハイフン）: 1990/01/15, 1990-01-15
      /(19|20)\d{2}[/\-](0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])/g,
      // 西暦（日本語）: 1990年1月15日
      /(19|20)\d{2}年(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])日/g,
      // 和暦: 昭和65年1月15日, 平成2年1月15日, 令和5年1月15日
      /(明治|大正|昭和|平成|令和)\d{1,2}年(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])日/g,
    ],
    enabled: true,
    priority: 40,
  },

  // 住所 (優先度: 50)
  {
    type: PIIType.ADDRESS,
    patterns: [
      // 郵便番号: 〒123-4567, 123-4567
      /〒?\d{3}-\d{4}/g,
      // 都道府県から始まる住所
      /(東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\s,、。\n]{2,}/g,
    ],
    enabled: true,
    priority: 50,
  },

  // 日本語氏名 (優先度: 100 - 最も汎用的なので最低優先度)
  {
    type: PIIType.NAME,
    patterns: [
      // 漢字の姓名（スペースあり）: 山田 太郎, 佐藤　花子
      /[\u4e00-\u9faf]{1,4}[\s　][\u4e00-\u9faf]{1,4}/g,
      // 漢字の姓名（スペースなし、3-6文字）: 山田太郎
      // ※誤検知を減らすため、より厳密なパターン
      /(?<![一-龯])([一-龯]{2,3})([一-龯]{2,3})(?![一-龯])/g,
    ],
    enabled: true,
    priority: 100,
  },
];

/**
 * 正規表現パターンをコピーして新しいインスタンスを返す
 * グローバルフラグを持つ正規表現はlastIndexを保持するため、
 * 毎回新しいインスタンスを使う必要がある
 */
function clonePattern(pattern: PIIPattern): PIIPattern {
  return {
    ...pattern,
    patterns: pattern.patterns.map(
      (regex) => new RegExp(regex.source, regex.flags)
    ),
  };
}

/**
 * パターンレジストリクラス
 * 設定に基づいてパターンの有効/無効を管理
 */
export class PatternRegistry {
  private patterns: PIIPattern[];

  constructor(customPatterns?: PIIPattern[]) {
    // デフォルトパターンをコピーして初期化
    this.patterns = customPatterns
      ? customPatterns.map(clonePattern)
      : DEFAULT_PATTERNS.map(clonePattern);
  }

  /**
   * 有効なパターンのみを取得（優先度順にソート）
   */
  getEnabledPatterns(): PIIPattern[] {
    return this.patterns
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(clonePattern);
  }

  /**
   * 全パターンを取得
   */
  getAllPatterns(): PIIPattern[] {
    return this.patterns.map(clonePattern);
  }

  /**
   * 特定のPII種別のパターンを有効/無効に設定
   */
  setEnabled(type: PIIType, enabled: boolean): void {
    const pattern = this.patterns.find((p) => p.type === type);
    if (pattern) {
      pattern.enabled = enabled;
    }
  }

  /**
   * 設定からパターンの有効/無効を一括設定
   */
  updateFromConfig(enabledTypes: Record<PIIType, boolean>): void {
    for (const [type, enabled] of Object.entries(enabledTypes)) {
      this.setEnabled(type as PIIType, enabled);
    }
  }

  /**
   * パターンを初期状態にリセット
   */
  reset(): void {
    this.patterns = DEFAULT_PATTERNS.map(clonePattern);
  }
}
