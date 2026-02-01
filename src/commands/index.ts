/**
 * VSCodeコマンドの登録と実装
 */

import * as vscode from 'vscode';
import { PIIDetector } from '../core/piiDetector';
import { Anonymizer } from '../core/anonymizer';
import { Deanonymizer } from '../core/deanonymizer';
import { MappingService } from '../services/mappingService';

/**
 * コマンドコンテキスト
 * 各コマンドで共有するインスタンス
 */
export interface CommandContext {
  detector: PIIDetector;
  anonymizer: Anonymizer;
  deanonymizer: Deanonymizer;
  mappingService: MappingService;
}

/**
 * 全コマンドを登録
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  ctx: CommandContext
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // 選択テキストを仮名化
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.anonymizeSelection',
      () => anonymizeSelection(ctx)
    )
  );

  // ドキュメント全体を仮名化
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.anonymizeDocument',
      () => anonymizeDocument(ctx)
    )
  );

  // 選択テキストを復元
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.deanonymizeSelection',
      () => deanonymizeSelection(ctx)
    )
  );

  // ドキュメント全体を復元
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.deanonymizeDocument',
      () => deanonymizeDocument(ctx)
    )
  );

  // マッピングを表示
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.showMapping',
      () => showMapping(ctx)
    )
  );

  // マッピングをクリア
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.clearMapping',
      () => clearMapping(ctx)
    )
  );

  return disposables;
}

/**
 * 選択テキストを仮名化
 */
async function anonymizeSelection(ctx: CommandContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DataAirlock: アクティブなエディタがありません');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('DataAirlock: テキストが選択されていません');
    return;
  }

  const selectedText = editor.document.getText(selection);
  const documentUri = editor.document.uri.toString();

  // PII検出
  const matches = ctx.detector.detect(selectedText);
  if (matches.length === 0) {
    vscode.window.showInformationMessage('DataAirlock: PIIは検出されませんでした');
    return;
  }

  // 仮名化
  const { result, newEntries } = ctx.anonymizer.anonymize(
    selectedText,
    matches,
    ctx.mappingService.getMapping(),
    documentUri
  );

  // マッピングに追加
  ctx.mappingService.addEntries(newEntries);

  // テキストを置換
  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, result);
  });

  vscode.window.showInformationMessage(
    `DataAirlock: ${matches.length}件のPIIを仮名化（マッピング: ${ctx.mappingService.getCount()}件保存）`
  );
}

/**
 * ドキュメント全体を仮名化
 */
async function anonymizeDocument(ctx: CommandContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DataAirlock: アクティブなエディタがありません');
    return;
  }

  const document = editor.document;
  const text = document.getText();
  const documentUri = document.uri.toString();

  // PII検出
  const matches = ctx.detector.detect(text);
  if (matches.length === 0) {
    vscode.window.showInformationMessage('DataAirlock: PIIは検出されませんでした');
    return;
  }

  // 仮名化
  const { result, newEntries } = ctx.anonymizer.anonymize(
    text,
    matches,
    ctx.mappingService.getMapping(),
    documentUri
  );

  // マッピングに追加
  ctx.mappingService.addEntries(newEntries);

  // ドキュメント全体を置換
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(text.length)
  );

  await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, result);
  });

  vscode.window.showInformationMessage(
    `DataAirlock: ${matches.length}件のPIIを仮名化しました`
  );
}

/**
 * 選択テキストを復元
 */
async function deanonymizeSelection(ctx: CommandContext): Promise<void> {
  try {
    console.log('DataAirlock: deanonymizeSelection started');

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DataAirlock: アクティブなエディタがありません');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('DataAirlock: テキストが選択されていません');
      return;
    }

    const selectedText = editor.document.getText(selection);
    console.log('DataAirlock: Selected text length:', selectedText.length);

    const mapping = ctx.mappingService.getMapping();
    console.log('DataAirlock: Mapping entries:', ctx.mappingService.getCount());

  // プレースホルダーの検出
  const placeholders = ctx.deanonymizer.findPlaceholders(selectedText);
  if (placeholders.length === 0) {
    vscode.window.showInformationMessage('DataAirlock: プレースホルダーは検出されませんでした');
    return;
  }

  // 復元可能なプレースホルダー数をカウント
  const restorableCount = ctx.deanonymizer.countRestorablePlaceholders(
    selectedText,
    mapping
  );

  // マッピング状態を確認
  const totalMappings = ctx.mappingService.getCount();

  if (restorableCount === 0) {
    vscode.window.showWarningMessage(
      `DataAirlock: 復元できません（プレースホルダー: ${placeholders.length}件、マッピング: ${totalMappings}件）`
    );
    return;
  }

  // 復元
  const restored = ctx.deanonymizer.deanonymize(selectedText, mapping);
  console.log('DataAirlock: Restored text length:', restored.length);

  // テキストを置換
  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, restored);
  });

  vscode.window.showInformationMessage(
    `DataAirlock: ${restorableCount}件のPIIを復元しました`
  );
  } catch (error) {
    console.error('DataAirlock: deanonymizeSelection error:', error);
    vscode.window.showErrorMessage(`DataAirlock エラー: ${error}`);
  }
}

/**
 * ドキュメント全体を復元
 */
async function deanonymizeDocument(ctx: CommandContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DataAirlock: アクティブなエディタがありません');
    return;
  }

  const document = editor.document;
  const text = document.getText();
  const mapping = ctx.mappingService.getMapping();

  // プレースホルダーの検出
  const placeholders = ctx.deanonymizer.findPlaceholders(text);
  if (placeholders.length === 0) {
    vscode.window.showInformationMessage('DataAirlock: プレースホルダーは検出されませんでした');
    return;
  }

  // 復元可能なプレースホルダー数をカウント
  const restorableCount = ctx.deanonymizer.countRestorablePlaceholders(
    text,
    mapping
  );

  // 復元
  const restored = ctx.deanonymizer.deanonymize(text, mapping);

  // ドキュメント全体を置換
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(text.length)
  );

  await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, restored);
  });

  vscode.window.showInformationMessage(
    `DataAirlock: ${restorableCount}件のPIIを復元しました`
  );
}

/**
 * マッピングを表示
 */
async function showMapping(ctx: CommandContext): Promise<void> {
  const entries = ctx.mappingService.getAllEntries();

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      'DataAirlock: 現在のセッションにマッピングはありません'
    );
    return;
  }

  // QuickPickアイテムを作成
  const items = entries.map((e) => ({
    label: e.placeholder,
    description: e.original,
    detail: `種別: ${e.type}`,
  }));

  await vscode.window.showQuickPick(items, {
    placeHolder: 'PIIマッピング一覧',
    matchOnDescription: true,
    matchOnDetail: true,
  });
}

/**
 * マッピングをクリア
 */
async function clearMapping(ctx: CommandContext): Promise<void> {
  const count = ctx.mappingService.getCount();

  if (count === 0) {
    vscode.window.showInformationMessage(
      'DataAirlock: クリアするマッピングはありません'
    );
    return;
  }

  // 確認ダイアログ
  const confirmed = await vscode.window.showWarningMessage(
    `DataAirlock: ${count}件のマッピングをクリアしますか？\n復元できなくなります。`,
    { modal: true },
    'クリア'
  );

  if (confirmed === 'クリア') {
    ctx.mappingService.clear();
    vscode.window.showInformationMessage(
      'DataAirlock: マッピングをクリアしました'
    );
  }
}
