/**
 * DataAirlock VSCode Extension
 * 日本語PII（個人情報）をローカルで仮名化/復元するVSCode拡張機能
 *
 * @description
 * - テキスト中のPII（氏名、電話番号、メール、住所、マイナンバー、生年月日）を検出
 * - プレースホルダー（[NAME_001]等）に置換して仮名化
 * - マッピングを使用して元の値に復元
 * - すべての処理はローカルで完結（ネットワーク通信なし）
 */

import * as vscode from 'vscode';
import { PIIType } from './types';
import { PatternRegistry, PIIDetector, Anonymizer, Deanonymizer } from './core';
import { MappingService, DecorationService, FileProcessor } from './services';
import { registerCommands, CommandContext } from './commands';
import { registerFileCommands, FileCommandContext } from './commands/fileCommands';
import { StatusBarManager, MappingTreeViewManager } from './ui';

/** 破棄対象のリソース */
let disposables: vscode.Disposable[] = [];

/**
 * 拡張機能の有効化
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('DataAirlock: Activating extension');

  // 設定を取得
  const config = vscode.workspace.getConfiguration('dataairlock');

  // パターンレジストリを初期化（設定に基づいて有効/無効を設定）
  const patternRegistry = new PatternRegistry();
  updatePatternSettings(patternRegistry, config);

  // コアコンポーネントを初期化
  const detector = new PIIDetector(patternRegistry.getEnabledPatterns());
  const anonymizer = new Anonymizer();
  const deanonymizer = new Deanonymizer();

  // サービスを初期化
  const mappingService = new MappingService();
  const highlightColor = config.get<string>('highlightColor', 'rgba(255, 200, 0, 0.3)');
  const decorationService = new DecorationService(detector, deanonymizer, highlightColor);

  // ハイライトの有効/無効を設定
  const highlightEnabled = config.get<boolean>('highlight.enabled', true);
  decorationService.setHighlightEnabled(highlightEnabled);

  // UIコンポーネントを初期化
  const statusBar = new StatusBarManager(mappingService);
  const treeView = new MappingTreeViewManager(mappingService);

  // コマンドコンテキストを作成
  const commandContext: CommandContext = {
    detector,
    anonymizer,
    deanonymizer,
    mappingService,
  };

  // ファイルプロセッサを初期化
  const fileProcessor = new FileProcessor(detector, anonymizer, deanonymizer);

  // ファイルコマンドコンテキストを作成
  const fileCommandContext: FileCommandContext = {
    fileProcessor,
  };

  // コマンドを登録
  const commandDisposables = registerCommands(context, commandContext);
  const fileCommandDisposables = registerFileCommands(context, fileCommandContext);

  // イベントリスナーを設定
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        decorationService.updateDecorations(editor);
      }
    }
  );

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        decorationService.updateDecorations(editor);
      }
    }
  );

  // 設定変更時のリスナー
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration('dataairlock')) {
        const newConfig = vscode.workspace.getConfiguration('dataairlock');

        // パターン設定を更新
        updatePatternSettings(patternRegistry, newConfig);
        detector.updatePatterns(patternRegistry.getEnabledPatterns());

        // ハイライト設定を更新
        const newHighlightEnabled = newConfig.get<boolean>(
          'highlight.enabled',
          true
        );
        decorationService.setHighlightEnabled(newHighlightEnabled);

        const newHighlightColor = newConfig.get<string>(
          'highlightColor',
          'rgba(255, 200, 0, 0.3)'
        );
        decorationService.updateHighlightColor(newHighlightColor);

        // 検出器を更新
        decorationService.updateDetector(detector);

        // 現在のエディタで装飾を再適用
        if (vscode.window.activeTextEditor) {
          decorationService.updateDecorations(vscode.window.activeTextEditor);
        }
      }
    }
  );

  // 初期の装飾を適用
  if (vscode.window.activeTextEditor) {
    decorationService.updateDecorations(vscode.window.activeTextEditor);
  }

  // リソースを登録
  disposables = [
    statusBar,
    treeView,
    decorationService,
    mappingService,
    editorChangeListener,
    documentChangeListener,
    configChangeListener,
    ...commandDisposables,
    ...fileCommandDisposables,
  ];

  context.subscriptions.push(...disposables);

  console.log('DataAirlock: Extension activated');
}

/**
 * 拡張機能の無効化
 */
export function deactivate(): void {
  console.log('DataAirlock: Deactivating extension');

  // リソースを解放
  for (const disposable of disposables) {
    disposable.dispose();
  }
  disposables = [];

  console.log('DataAirlock: Extension deactivated');
}

/**
 * 設定からパターンの有効/無効を更新
 */
function updatePatternSettings(
  registry: PatternRegistry,
  config: vscode.WorkspaceConfiguration
): void {
  const patternTypes: Array<{ key: string; type: PIIType }> = [
    { key: 'patterns.name.enabled', type: PIIType.NAME },
    { key: 'patterns.phone.enabled', type: PIIType.PHONE },
    { key: 'patterns.email.enabled', type: PIIType.EMAIL },
    { key: 'patterns.address.enabled', type: PIIType.ADDRESS },
    { key: 'patterns.mynumber.enabled', type: PIIType.MYNUMBER },
    { key: 'patterns.dob.enabled', type: PIIType.DOB },
  ];

  for (const { key, type } of patternTypes) {
    const enabled = config.get<boolean>(key, true);
    registry.setEnabled(type, enabled);
  }
}
