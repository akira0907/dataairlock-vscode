/**
 * ファイル・フォルダ単位の仮名化/復元コマンド
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { FileProcessor } from '../services/fileProcessor';
import { MappingStorage } from '../services/mappingStorage';
import { BackupService } from '../services/backupService';

/**
 * ファイルコマンドのコンテキスト
 */
export interface FileCommandContext {
  fileProcessor: FileProcessor;
}

/**
 * ファイル・フォルダコマンドを登録
 */
export function registerFileCommands(
  context: vscode.ExtensionContext,
  ctx: FileCommandContext
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ファイルを仮名化
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.anonymizeFile',
      (uri: vscode.Uri) => anonymizeFile(ctx, uri)
    )
  );

  // フォルダを仮名化
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.anonymizeFolder',
      (uri: vscode.Uri) => anonymizeFolder(ctx, uri)
    )
  );

  // ファイルを復元
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.deanonymizeFile',
      (uri: vscode.Uri) => deanonymizeFile(ctx, uri)
    )
  );

  // フォルダを復元
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.deanonymizeFolder',
      (uri: vscode.Uri) => deanonymizeFolder(ctx, uri)
    )
  );

  // マッピングを適用（成果物の復元）
  disposables.push(
    vscode.commands.registerCommand(
      'dataairlock.applyMapping',
      (uri: vscode.Uri) => applyMapping(ctx, uri)
    )
  );

  return disposables;
}

/**
 * ファイルを仮名化
 */
async function anonymizeFile(
  ctx: FileCommandContext,
  uri?: vscode.Uri
): Promise<void> {
  try {
    // URIが指定されていない場合はダイアログで選択
    let filePath: string;
    if (uri) {
      filePath = uri.fsPath;
    } else {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: '仮名化するファイルを選択',
      });
      if (!selected || selected.length === 0) {
        return;
      }
      filePath = selected[0].fsPath;
    }

    // 進捗表示
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DataAirlock: ファイルを仮名化中...',
        cancellable: false,
      },
      async () => {
        const result = await ctx.fileProcessor.anonymizeFile(filePath);

        if (result.success) {
          const message = result.piiFound > 0
            ? `仮名化完了: ${result.piiFound}件のPIIを検出\n出力先: ${result.outputPath}`
            : `完了: PIIは検出されませんでした\n出力先: ${result.outputPath}`;

          const action = await vscode.window.showInformationMessage(
            `DataAirlock: ${message}`,
            'フォルダを開く'
          );

          if (action === 'フォルダを開く') {
            vscode.commands.executeCommand(
              'revealFileInOS',
              vscode.Uri.file(result.outputPath)
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `DataAirlock: エラー - ${result.errors.join(', ')}`
          );
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`DataAirlock: エラー - ${error}`);
  }
}

/**
 * フォルダを仮名化
 */
async function anonymizeFolder(
  ctx: FileCommandContext,
  uri?: vscode.Uri
): Promise<void> {
  try {
    // URIが指定されていない場合はダイアログで選択
    let folderPath: string;
    if (uri) {
      folderPath = uri.fsPath;
    } else {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: '仮名化するフォルダを選択',
      });
      if (!selected || selected.length === 0) {
        return;
      }
      folderPath = selected[0].fsPath;
    }

    // 出力先を選択（airlock方式）
    const config = vscode.workspace.getConfiguration('dataairlock');
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('DataAirlock: ワークスペースが開かれていません');
      return;
    }

    const airlockFolderName = config.get<string>('airlockFolderName', 'airlock');
    const airlockBase = path.join(workspaceFolders[0].uri.fsPath, airlockFolderName);
    const folderName = path.basename(folderPath);
    const defaultOutput = path.join(airlockBase, folderName);

    const outputChoice = await vscode.window.showQuickPick(
      [
        { label: '自動（airlockフォルダに出力）', description: defaultOutput, value: 'auto' },
        { label: '出力先を選択...', description: 'カスタム出力先を指定', value: 'custom' },
      ],
      { placeHolder: '出力先を選択してください' }
    );

    if (!outputChoice) {
      return;
    }

    let outputPath = defaultOutput;
    if (outputChoice.value === 'custom') {
      const customOutput = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: '出力先フォルダを選択（この中に仮名化フォルダが作成されます）',
      });
      if (!customOutput || customOutput.length === 0) {
        return;
      }
      // 選択したフォルダ内に、元フォルダ名で作成
      outputPath = path.join(customOutput[0].fsPath, folderName);
    }

    // バックアップオプションを確認
    const autoBackup = config.get<boolean>('autoBackup', true);
    const backupDir = BackupService.getBackupDirectory();

    const backupChoice = await vscode.window.showQuickPick(
      [
        {
          label: '$(shield) 元データをバックアップして削除（推奨）',
          description: `${backupDir} に退避`,
          value: 'backup',
        },
        {
          label: '$(eye-closed) 元データを残す（.ignore/.claudeignoreで隠す）',
          description: 'Claude/検索ツールから見えにくくなりますが完全ではありません',
          value: 'keep',
        },
      ],
      { placeHolder: '元データの処理方法を選択してください' }
    );

    if (!backupChoice) {
      return;
    }

    // 確認ダイアログ
    const confirmMessage = backupChoice.value === 'backup'
      ? `DataAirlock: フォルダを仮名化しますか？\n入力: ${folderPath}\n出力: ${outputPath}\n\n※ 元データは ${backupDir} に移動されます`
      : `DataAirlock: フォルダを仮名化しますか？\n入力: ${folderPath}\n出力: ${outputPath}\n\n※ 元データは.ignore/.claudeignoreで隠されます`;

    const confirm = await vscode.window.showWarningMessage(
      confirmMessage,
      { modal: true },
      '実行'
    );

    if (confirm !== '実行') {
      return;
    }

    // 進捗表示
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DataAirlock: フォルダを仮名化中...',
        cancellable: false,
      },
      async (progress) => {
        const result = await ctx.fileProcessor.anonymizeFolder(
          folderPath,
          progress,
          outputPath
        );

        if (result.success || result.filesProcessed > 0) {
          let backupMessage = '';

          if (backupChoice.value === 'backup') {
            // 元データをバックアップに移動
            progress.report({ message: 'バックアップ中...' });
            const backupResult = await BackupService.backupFolder(
              folderPath,
              result.outputPath
            );

            if (backupResult) {
              backupMessage = `\n元データ: ${backupDir} に退避済み`;
            } else {
              backupMessage = '\n※ バックアップに失敗しました（元データはそのまま）';
              // バックアップ失敗時は.ignore/.claudeignoreを生成
              await generateClaudeignore(folderPath, result.outputPath);
            }
          } else {
            // .ignore/.claudeignoreを生成（元フォルダをClaude/検索ツールから隠す）
            await generateClaudeignore(folderPath, result.outputPath);
            backupMessage = '\n※ .ignore/.claudeignoreを生成しました';
          }

          const message = `仮名化完了: ${result.filesProcessed}ファイル処理、${result.piiFound}件のPIIを検出`;

          const action = await vscode.window.showInformationMessage(
            `DataAirlock: ${message}\n出力先: ${result.outputPath}${backupMessage}`,
            'フォルダを開く'
          );

          if (action === 'フォルダを開く') {
            vscode.commands.executeCommand(
              'revealFileInOS',
              vscode.Uri.file(result.outputPath)
            );
          }
        }

        if (result.errors.length > 0) {
          vscode.window.showWarningMessage(
            `DataAirlock: 一部エラー - ${result.errors.slice(0, 3).join(', ')}`
          );
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`DataAirlock: エラー - ${error}`);
  }
}

/**
 * ファイルを復元
 */
async function deanonymizeFile(
  ctx: FileCommandContext,
  uri?: vscode.Uri
): Promise<void> {
  try {
    // URIが指定されていない場合はダイアログで選択
    let filePath: string;
    if (uri) {
      filePath = uri.fsPath;
    } else {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: '復元するファイルを選択',
      });
      if (!selected || selected.length === 0) {
        return;
      }
      filePath = selected[0].fsPath;
    }

    // 進捗表示
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DataAirlock: ファイルを復元中...',
        cancellable: false,
      },
      async () => {
        const result = await ctx.fileProcessor.deanonymizeFile(filePath);

        if (result.success) {
          vscode.window.showInformationMessage(
            `DataAirlock: 復元完了 - ${result.piiFound}件のPIIを復元しました`
          );
        } else {
          vscode.window.showErrorMessage(
            `DataAirlock: エラー - ${result.errors.join(', ')}`
          );
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`DataAirlock: エラー - ${error}`);
  }
}

/**
 * フォルダを復元
 */
async function deanonymizeFolder(
  ctx: FileCommandContext,
  uri?: vscode.Uri
): Promise<void> {
  try {
    // URIが指定されていない場合はダイアログで選択
    let folderPath: string;
    if (uri) {
      folderPath = uri.fsPath;
    } else {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: '復元するフォルダを選択（airlock配下の仮名化フォルダ）',
      });
      if (!selected || selected.length === 0) {
        return;
      }
      folderPath = selected[0].fsPath;
    }

    // マッピングファイルの存在確認
    const hasMappingFile = await MappingStorage.mappingExists(folderPath);
    if (!hasMappingFile) {
      vscode.window.showErrorMessage(
        `DataAirlock: mapping が見つかりません。airlock配下の仮名化フォルダ（またはその配下のフォルダ）を選択してください。`
      );
      return;
    }

    // バックアップがあるか確認
    const backup = await BackupService.findBackupByPseudonymizedPath(folderPath);

    let restoreMode: 'backup' | 'inplace' = 'inplace';

    if (backup) {
      // バックアップがある場合は選択肢を表示
      const restoreChoice = await vscode.window.showQuickPick(
        [
          {
            label: '$(history) バックアップから元データを復元（推奨）',
            description: `${backup.originalPath} に復元`,
            value: 'backup' as const,
          },
          {
            label: '$(replace) 仮名化データを直接復元',
            description: 'プレースホルダーを元の値に置換',
            value: 'inplace' as const,
          },
        ],
        { placeHolder: '復元方法を選択してください' }
      );

      if (!restoreChoice) {
        return;
      }

      restoreMode = restoreChoice.value;
    }

    if (restoreMode === 'backup' && backup) {
      // バックアップから復元
      const confirm = await vscode.window.showWarningMessage(
        `DataAirlock: バックアップから元データを復元しますか？\n\n復元先: ${backup.originalPath}\nバックアップ日時: ${new Date(backup.createdAt).toLocaleString()}`,
        { modal: true },
        '復元'
      );

      if (confirm !== '復元') {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'DataAirlock: バックアップから復元中...',
          cancellable: false,
        },
        async () => {
          const success = await BackupService.restoreFromBackup(backup.id);

          if (success) {
            vscode.window.showInformationMessage(
              `DataAirlock: 復元完了\n元データ: ${backup.originalPath}\n\n仮名化フォルダは残っています。不要であれば削除してください。`
            );
          } else {
            vscode.window.showErrorMessage(
              `DataAirlock: バックアップからの復元に失敗しました`
            );
          }
        }
      );
    } else {
      // 従来の直接復元
      const confirm = await vscode.window.showWarningMessage(
        `DataAirlock: フォルダ "${folderPath}" のファイルを復元しますか？\nファイルは上書きされます。`,
        { modal: true },
        '実行'
      );

      if (confirm !== '実行') {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'DataAirlock: フォルダを復元中...',
          cancellable: false,
        },
        async (progress) => {
          const result = await ctx.fileProcessor.deanonymizeFolder(
            folderPath,
            progress
          );

          if (result.success || result.filesProcessed > 0) {
            vscode.window.showInformationMessage(
              `DataAirlock: 復元完了 - ${result.filesProcessed}ファイル処理、${result.piiFound}件のPIIを復元\n出力先: ${result.outputPath}`
            );
          }

          if (result.errors.length > 0) {
            vscode.window.showWarningMessage(
              `DataAirlock: 一部エラー - ${result.errors.slice(0, 3).join(', ')}`
            );
          }
        }
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`DataAirlock: エラー - ${error}`);
  }
}

/**
 * マッピングを適用（成果物の復元）
 * Claudeが生成したファイルに含まれるプレースホルダーを元の値に置換
 */
async function applyMapping(
  ctx: FileCommandContext,
  uri?: vscode.Uri
): Promise<void> {
  try {
    // 対象ファイル/フォルダを取得
    let targetPath: string;
    let isFolder = false;

    if (uri) {
      targetPath = uri.fsPath;
      const stat = await fs.promises.stat(targetPath);
      isFolder = stat.isDirectory();
    } else {
      // ダイアログで選択
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'ファイルを選択', value: 'file' },
          { label: 'フォルダを選択', value: 'folder' },
        ],
        { placeHolder: 'マッピングを適用する対象を選択' }
      );

      if (!choice) {
        return;
      }

      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: choice.value === 'file',
        canSelectFolders: choice.value === 'folder',
        canSelectMany: false,
        title: 'マッピングを適用する対象を選択',
      });

      if (!selected || selected.length === 0) {
        return;
      }

      targetPath = selected[0].fsPath;
      isFolder = choice.value === 'folder';
    }

    const exists = async (p: string): Promise<boolean> => {
      try {
        await fs.promises.access(p);
        return true;
      } catch {
        return false;
      }
    };

    const listMappingFilesInDir = async (dirPath: string): Promise<string[]> => {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
          .map((e) => path.join(dirPath, e.name));
      } catch {
        return [];
      }
    };

    // マッピングファイルを選択
    const backups = await BackupService.listBackups();

    const mappingChoices: Array<{ label: string; description: string; mappingPath: string }> = [];

    // まずは対象パスからマッピングを自動検出（airlock/.mapping/<SOURCE>.json を上に辿って探索）
    const targetDirForMapping = isFolder ? targetPath : path.dirname(targetPath);
    if (await MappingStorage.mappingExists(targetDirForMapping)) {
      const inferred = await MappingStorage.getMappingPathAsync(targetDirForMapping);
      if (await exists(inferred)) {
        mappingChoices.push({
          label: '$(sparkle) 自動検出（推奨）',
          description: inferred,
          mappingPath: inferred,
        });
      }
    }

    // ワークスペース内の airlock/.mapping を一覧に追加（.mapping がファイル選択ダイアログで見えない問題回避）
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const config = vscode.workspace.getConfiguration('dataairlock');
      const airlockFolderName = config.get<string>('airlockFolderName', 'airlock');
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      // 将来の互換性のため `.mapping` と `mapping` の両方を探索
      const candidateDirs = [
        path.join(workspaceRoot, airlockFolderName, '.mapping'),
        path.join(workspaceRoot, airlockFolderName, 'mapping'),
      ];

      for (const dir of candidateDirs) {
        const mappingFiles = await listMappingFilesInDir(dir);
        for (const mp of mappingFiles) {
          mappingChoices.push({
            label: `$(symbol-key) ${path.basename(mp)}`,
            description: mp,
            mappingPath: mp,
          });
        }
      }
    }

    // バックアップからのマッピング
    for (const backup of backups.slice(0, 5)) {
      // pseudonymized folderのmapping.jsonを使用
      if (await MappingStorage.mappingExists(backup.pseudonymizedPath)) {
        const mappingPath = await MappingStorage.getMappingPathAsync(backup.pseudonymizedPath);
        mappingChoices.push({
          label: `$(archive) ${backup.projectName}`,
          description: `${new Date(backup.createdAt).toLocaleString()} - ${backup.pseudonymizedPath}`,
          mappingPath,
        });
      }
    }

    // カスタムマッピングファイル選択オプション
    mappingChoices.push({
      label: '$(file) mapping.jsonを選択...',
      description: 'カスタムマッピングファイルを指定',
      mappingPath: '',
    });

    mappingChoices.push({
      label: '$(pencil) パスを入力...',
      description: '.mapping が見えない場合はこちら（例: /path/to/airlock/.mapping/input.json）',
      mappingPath: '__INPUT__',
    });

    if (mappingChoices.length === 1) {
      // バックアップがない場合は直接ファイル選択
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'mapping.jsonを選択',
        filters: { 'JSON': ['json'] },
      });

      if (!selected || selected.length === 0) {
        return;
      }

      mappingChoices[0].mappingPath = selected[0].fsPath;
    }

    const mappingChoice = await vscode.window.showQuickPick(mappingChoices, {
      placeHolder: '使用するマッピングを選択',
    });

    if (!mappingChoice) {
      return;
    }

    let mappingPath = mappingChoice.mappingPath;

    if (mappingPath === '__INPUT__') {
      const input = await vscode.window.showInputBox({
        title: 'mapping.json のパスを入力',
        prompt: '例: /path/to/airlock/.mapping/input.json',
        ignoreFocusOut: true,
      });

      if (!input) {
        return;
      }
      mappingPath = input.trim();
    }

    if (!mappingPath) {
      // カスタムマッピングファイル選択
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'mapping.jsonを選択',
        filters: { 'JSON': ['json'] },
      });

      if (!selected || selected.length === 0) {
        return;
      }

      mappingPath = selected[0].fsPath;
    }

    // 確認ダイアログ
    const confirm = await vscode.window.showWarningMessage(
      `DataAirlock: マッピングを適用しますか？\n\n対象: ${targetPath}\nマッピング: ${mappingPath}\n\n※ プレースホルダーが元の値に置換されます`,
      { modal: true },
      '適用'
    );

    if (confirm !== '適用') {
      return;
    }

    // マッピングを読み込み
    const mapping = await MappingStorage.loadMapping(mappingPath);

    // 進捗表示
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DataAirlock: マッピングを適用中...',
        cancellable: false,
      },
      async (progress) => {
        let filesProcessed = 0;
        let totalReplaced = 0;

        if (isFolder) {
          // フォルダの場合は再帰的に処理
          const result = await applyMappingToFolder(
            ctx,
            targetPath,
            mapping,
            progress
          );
          filesProcessed = result.filesProcessed;
          totalReplaced = result.replacedCount;
        } else {
          // 単一ファイル
          const result = await applyMappingToFile(ctx, targetPath, mapping);
          filesProcessed = 1;
          totalReplaced = result;
        }

        vscode.window.showInformationMessage(
          `DataAirlock: マッピング適用完了\n${filesProcessed}ファイル処理、${totalReplaced}件のプレースホルダーを復元`
        );
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`DataAirlock: エラー - ${error}`);
  }
}

/**
 * 単一ファイルにマッピングを適用
 */
async function applyMappingToFile(
  _ctx: FileCommandContext,
  filePath: string,
  mapping: import('../types').SessionMapping
): Promise<number> {
  const ext = path.extname(filePath).toLowerCase();

  // Excelファイルの場合は専用処理
  if (ext === '.xlsx' || ext === '.xls') {
    return applyMappingToExcel(filePath, mapping);
  }

  // テキストファイルの場合
  const content = await fs.promises.readFile(filePath, 'utf-8');

  // プレースホルダーパターン
  const placeholderPattern = /\[(NAME|PHONE|EMAIL|ADDRESS|MYNUMBER|DOB)_\d{3}\]/g;

  let replacedCount = 0;
  const newContent = content.replace(placeholderPattern, (match) => {
    const entry = mapping.entries.get(match);
    if (entry) {
      replacedCount++;
      return entry.original;
    }
    return match;
  });

  if (replacedCount > 0) {
    await fs.promises.writeFile(filePath, newContent, 'utf-8');
  }

  return replacedCount;
}

/**
 * Excelファイルにマッピングを適用
 */
async function applyMappingToExcel(
  filePath: string,
  mapping: import('../types').SessionMapping
): Promise<number> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // プレースホルダーパターン
  const placeholderPattern = /\[(NAME|PHONE|EMAIL|ADDRESS|MYNUMBER|DOB)_\d{3}\]/g;

  let replacedCount = 0;

  // 全シートを処理
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') {
          const newValue = cell.value.replace(placeholderPattern, (match) => {
            const entry = mapping.entries.get(match);
            if (entry) {
              replacedCount++;
              return entry.original;
            }
            return match;
          });
          if (newValue !== cell.value) {
            cell.value = newValue;
          }
        }
      });
    });
  });

  if (replacedCount > 0) {
    await workbook.xlsx.writeFile(filePath);
  }

  return replacedCount;
}

/**
 * フォルダにマッピングを適用
 */
async function applyMappingToFolder(
  ctx: FileCommandContext,
  folderPath: string,
  mapping: import('../types').SessionMapping,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ filesProcessed: number; replacedCount: number }> {
  const config = vscode.workspace.getConfiguration('dataairlock');
  const extensions = config.get<string[]>('fileExtensions', [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
    '.rb', '.go', '.rs', '.swift', '.xlsx', '.xls', '.yaml', '.yml'
  ]);

  let filesProcessed = 0;
  let totalReplaced = 0;

  const processDir = async (dir: string): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // node_modules等はスキップ
        if (!['node_modules', '.git', '.vscode'].includes(entry.name)) {
          await processDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          const replaced = await applyMappingToFile(ctx, fullPath, mapping);
          if (replaced > 0) {
            totalReplaced += replaced;
            filesProcessed++;
            progress.report({ message: `${filesProcessed} files processed` });
          }
        }
      }
    }
  };

  await processDir(folderPath);

  return { filesProcessed, replacedCount: totalReplaced };
}

/**
 * .ignore / .claudeignore を生成
 * 元フォルダ（個人情報を含む）やマッピングをClaude/検索ツールから隠す
 * ワークスペースルートに.ignore と .claudeignore を作成（後方互換のため両方）
 */
async function generateClaudeignore(
  originalFolder: string,
  _outputFolder: string
): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    // ワークスペースルートに.ignore / .claudeignoreを作成
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const ignoreFilePaths = [
      path.join(workspaceRoot, '.ignore'),
      path.join(workspaceRoot, '.claudeignore'),
    ];

    const normalizeIgnorePath = (p: string): string => p.replace(/\\/g, '/');
    const ensureTrailingSlash = (p: string): string =>
      p.endsWith('/') ? p : p + '/';

    // mapping（元PIIを含む）をClaudeから隠す: airlock/.mapping/
    const config = vscode.workspace.getConfiguration('dataairlock');
    const airlockFolderName = config.get<string>('airlockFolderName', 'airlock');
    const mappingRelative = ensureTrailingSlash(normalizeIgnorePath(path.join(airlockFolderName, '.mapping')));

    // 元フォルダのワークスペースルートからの相対パス
    const originalRelative = normalizeIgnorePath(path.relative(workspaceRoot, originalFolder));

    const originalEntry = ensureTrailingSlash(originalRelative);

    const entriesToEnsure = [mappingRelative, originalEntry];

    for (const ignorePath of ignoreFilePaths) {
      // 既存の ignore を読み込み
      let existingContent = '';
      try {
        existingContent = await fs.promises.readFile(ignorePath, 'utf-8');
      } catch {
        // ファイルが存在しない場合は新規作成
      }

      // 既にエントリがあるかチェック
      const lines = existingContent.split('\n').filter(line => line.trim());
      const missingEntries = entriesToEnsure.filter((entry) => {
        const trimmed = entry.replace(/[\\/]+$/, '');
        return !lines.includes(entry) && !lines.includes(trimmed);
      });

      if (missingEntries.length === 0) {
        continue;
      }

      // エントリを追加
      const header = '# DataAirlock: 仮名化前データ/マッピング（アクセス不可にするための除外設定）\n';
      const block = missingEntries.join('\n') + '\n';
      const newContent = existingContent
        ? existingContent.trimEnd() + '\n' + block
        : header + block;

      await fs.promises.writeFile(ignorePath, newContent, 'utf-8');
    }
  } catch (error) {
    console.error('DataAirlock: ignore生成エラー:', error);
  }
}
