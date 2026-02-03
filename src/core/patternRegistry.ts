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
      // 内線番号付き電話番号: 03-1234-5678-0115, 090-1234-5678-内線123
      /0\d{1,4}-\d{1,4}-\d{4}(?:-\d{1,6})?/g,
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
  // デフォルト無効: コンテキストベースの検出を使用（「生年月日」等の列名がある場合のみ）
  {
    type: PIIType.DOB,
    patterns: [
      // 西暦（スラッシュ/ハイフン）: 1990/01/15, 1990-01-15
      // ※日のパターンは長いものを先にマッチさせる
      /(19|20)\d{2}[/\-](0?[1-9]|1[0-2])[/\-]([12]\d|3[01]|0?[1-9])/g,
      // 西暦（日本語）: 1990年1月15日
      /(19|20)\d{2}年(0?[1-9]|1[0-2])月([12]\d|3[01]|0?[1-9])日/g,
      // 和暦: 昭和65年1月15日, 平成2年1月15日, 令和5年1月15日
      /(明治|大正|昭和|平成|令和)\d{1,2}年(0?[1-9]|1[0-2])月([12]\d|3[01]|0?[1-9])日/g,
    ],
    enabled: false,
    priority: 40,
    contextRequired: true,  // コンテキストベースの検出を有効化
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
      // 漢字の姓名（スペースあり）: 山田 太郎, 佐藤　花子, 田中　真吾
      // 姓2-4文字 + スペース + 名1-4文字
      // ※終端は括弧（全角/半角）も許容
      /(?<=[　\s,"\x5b]|^)[\u4e00-\u9faf]{2,4}[　\s][\u4e00-\u9faf]{1,4}(?=[　\s,、。"（(\n\x5d]|$)/g,
      // 漢字の姓名（スペースなし）+ 括弧（所属）: 山田太郎（内科）, 宇都宮大輔（放射線診断）
      // 3-8文字の漢字名 + 全角/半角括弧の直前
      /(?<=[,"\s　\x5b]|^)[\u4e00-\u9faf]{3,8}(?=[（(])/g,
      // 漢字の姓名（スペースなし、4-6文字）: 山田太郎（CSV等のクォート内）
      /(?<=["「『])[\u4e00-\u9faf]{4,6}(?=["」』])/g,
      // 漢字の姓名（スペースなし、区切り文字に囲まれる）: 田中太郎, names: [田中太郎, 鈴木花子], key: 田中太郎
      // 3-8文字の漢字列が「単語境界」とみなせる位置にある場合にマッチ
      /(?<=[　\s,"\x5b\x5d{}():,、。#\nはがをにのへとで]|^)[\u4e00-\u9faf]{3,8}(?=[　\s,"\x5b\x5d{}():,、。#\nはがをにのへとで]|$)/g,
      // カタカナの姓名（スペースあり）: ヤマダ タロウ, ミツハシ　コウヘイ
      /[ァ-ヶー]{2,6}[　\s][ァ-ヶー]{2,6}/g,
      // カタカナの姓名（スペースなし、4文字以上）: ヤマダタロウ
      /(?<![ァ-ヶー])[ァ-ヶー]{4,10}(?![ァ-ヶー])/g,
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
   * contextRequired: true のパターンも含める（コンテキストベース検出用）
   */
  getEnabledPatterns(): PIIPattern[] {
    return this.patterns
      .filter((p) => p.enabled || p.contextRequired)
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
   * 無効化時はコンテキストベース検出も無効化
   */
  setEnabled(type: PIIType, enabled: boolean): void {
    const pattern = this.patterns.find((p) => p.type === type);
    if (pattern) {
      pattern.enabled = enabled;
      // 明示的に無効化された場合、コンテキストベース検出も無効化
      if (!enabled && pattern.contextRequired) {
        pattern.contextRequired = false;
      }
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
