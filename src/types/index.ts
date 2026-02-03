/**
 * DataAirlock Type Definitions
 * PIIの種類、マッチ結果、マッピング管理の型を定義
 */

/**
 * 検出対象のPII（個人情報）種別
 */
export enum PIIType {
  NAME = 'NAME',           // 日本語氏名
  PHONE = 'PHONE',         // 電話番号
  EMAIL = 'EMAIL',         // メールアドレス
  ADDRESS = 'ADDRESS',     // 住所・郵便番号
  MYNUMBER = 'MYNUMBER',   // マイナンバー
  DOB = 'DOB'              // 生年月日
}

/**
 * PII検出パターンの定義
 */
export interface PIIPattern {
  /** PII種別 */
  type: PIIType;
  /** 検出用正規表現パターン（複数可） */
  patterns: RegExp[];
  /** パターンが有効かどうか */
  enabled: boolean;
  /** 優先度（低い数値が高優先、重複時に先にマッチしたものを優先） */
  priority: number;
  /** コンテキストベースの検出を有効にする（特定のキーワードが近くにある場合のみ検出） */
  contextRequired?: boolean;
}

/**
 * テキスト内で検出されたPIIのマッチ結果
 */
export interface PIIMatch {
  /** PII種別 */
  type: PIIType;
  /** マッチした元の値 */
  value: string;
  /** テキスト内の開始位置（0-indexed） */
  startIndex: number;
  /** テキスト内の終了位置（exclusive） */
  endIndex: number;
}

/**
 * 匿名化マッピングの1エントリ
 */
export interface MappingEntry {
  /** 置換後のプレースホルダー (例: [NAME_001]) */
  placeholder: string;
  /** 元の値 */
  original: string;
  /** PII種別 */
  type: PIIType;
  /** 関連するドキュメントURI */
  documentUri: string;
  /** 作成タイムスタンプ */
  createdAt: number;
}

/**
 * セッション内の全マッピングを管理する構造体
 */
export interface SessionMapping {
  /** プレースホルダー → エントリ のマップ */
  entries: Map<string, MappingEntry>;
  /** 元の値 → プレースホルダー のマップ（重複防止用） */
  reverseIndex: Map<string, string>;
  /** PII種別ごとのカウンター（次のIDを生成するため） */
  counters: Map<PIIType, number>;
}

/**
 * マッピング統計情報
 */
export interface MappingStats {
  /** 総エントリ数 */
  total: number;
  /** PII種別ごとのエントリ数 */
  byType: Record<PIIType, number>;
}
