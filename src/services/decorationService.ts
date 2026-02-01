/**
 * エディタ装飾サービス
 * PIIとプレースホルダーのハイライト表示を管理
 */

import * as vscode from 'vscode';
import { PIIDetector } from '../core/piiDetector';
import { Deanonymizer } from '../core/deanonymizer';

/**
 * 装飾サービスクラス
 */
export class DecorationService implements vscode.Disposable {
  /** PII検出箇所の装飾タイプ */
  private piiDecorationType: vscode.TextEditorDecorationType;
  /** プレースホルダーの装飾タイプ */
  private placeholderDecorationType: vscode.TextEditorDecorationType;
  /** デバウンス用タイマー */
  private debounceTimer: NodeJS.Timeout | undefined;
  /** ハイライト有効フラグ */
  private highlightEnabled: boolean = true;

  constructor(
    private detector: PIIDetector,
    private deanonymizer: Deanonymizer,
    highlightColor: string = 'rgba(255, 200, 0, 0.3)'
  ) {
    this.piiDecorationType = this.createPIIDecorationType(highlightColor);
    this.placeholderDecorationType = this.createPlaceholderDecorationType();
  }

  /**
   * PII装飾タイプを作成
   */
  private createPIIDecorationType(
    color: string
  ): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      borderRadius: '3px',
    });
  }

  /**
   * プレースホルダー装飾タイプを作成
   */
  private createPlaceholderDecorationType(): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      fontStyle: 'italic',
      color: new vscode.ThemeColor('editorInfo.foreground'),
      backgroundColor: 'rgba(100, 100, 255, 0.1)',
      borderRadius: '3px',
    });
  }

  /**
   * ハイライトの有効/無効を設定
   */
  setHighlightEnabled(enabled: boolean): void {
    this.highlightEnabled = enabled;
    if (!enabled) {
      // 無効にした場合、全てのエディタの装飾をクリア
      vscode.window.visibleTextEditors.forEach((editor) => {
        this.clearDecorations(editor);
      });
    }
  }

  /**
   * 装飾を更新（デバウンス付き）
   */
  updateDecorations(editor: vscode.TextEditor): void {
    if (!this.highlightEnabled) {
      return;
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.applyDecorations(editor);
    }, 100); // 100ms debounce
  }

  /**
   * 装飾を適用
   */
  private applyDecorations(editor: vscode.TextEditor): void {
    if (!this.highlightEnabled) {
      return;
    }

    const document = editor.document;
    const text = document.getText();

    // PII検出箇所をハイライト
    const piiMatches = this.detector.detect(text);
    const piiRanges: vscode.Range[] = piiMatches.map(
      (m) =>
        new vscode.Range(
          document.positionAt(m.startIndex),
          document.positionAt(m.endIndex)
        )
    );

    // プレースホルダーをハイライト
    const placeholders = this.deanonymizer.findPlaceholders(text);
    const placeholderRanges: vscode.Range[] = placeholders.map(
      (p) =>
        new vscode.Range(
          document.positionAt(p.start),
          document.positionAt(p.end)
        )
    );

    editor.setDecorations(this.piiDecorationType, piiRanges);
    editor.setDecorations(this.placeholderDecorationType, placeholderRanges);
  }

  /**
   * 装飾をクリア
   */
  clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.piiDecorationType, []);
    editor.setDecorations(this.placeholderDecorationType, []);
  }

  /**
   * ハイライト色を更新
   */
  updateHighlightColor(color: string): void {
    // 古い装飾タイプを破棄
    this.piiDecorationType.dispose();
    // 新しい装飾タイプを作成
    this.piiDecorationType = this.createPIIDecorationType(color);
    // 全てのエディタで装飾を再適用
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.updateDecorations(editor);
    });
  }

  /**
   * 検出器を更新
   */
  updateDetector(detector: PIIDetector): void {
    this.detector = detector;
  }

  /**
   * リソース解放
   */
  dispose(): void {
    clearTimeout(this.debounceTimer);
    this.piiDecorationType.dispose();
    this.placeholderDecorationType.dispose();
  }
}
