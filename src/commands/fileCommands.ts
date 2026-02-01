/**
 * ファイル・フォルダ単位の仮名化/復元コマンド
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

    // 出力先を選択
    const config = vscode.workspace.getConfiguration('dataairlock');
    const suffix = config.get<string>('outputFolderSuffix', '_pseudonymized');
    const defaultOutput = folderPath + suffix;

    const outputChoice = await vscode.window.showQuickPick(
      [
        { label: '自動（同階層に出力）', description: defaultOutput, value: 'auto' },
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
      // 選択したフォルダ内に、元フォルダ名+suffixで作成
      const folderName = path.basename(folderPath);
      outputPath = path.join(customOutput[0].fsPath, folderName + suffix);
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
          label: '$(eye-closed) 元データを残す（.claudeignoreで隠す）',
          description: 'Claudeからは見えなくなりますが完全ではありません',
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
      : `DataAirlock: フォルダを仮名化しますか？\n入力: ${folderPath}\n出力: ${outputPath}\n\n※ 元データは.claudeignoreで隠されます`;

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
              // バックアップ失敗時は.claudeignoreを生成
              await generateClaudeignore(folderPath, result.outputPath);
            }
          } else {
            // .claudeignoreを生成（元フォルダをClaudeから隠す）
            await generateClaudeignore(folderPath, result.outputPath);
            backupMessage = '\n※ .claudeignoreを生成しました';
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
        title: '復元するフォルダを選択（mapping.jsonを含むフォルダ）',
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
        `DataAirlock: mapping.json が見つかりません。仮名化されたフォルダを選択してください。`
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

    // マッピングファイルを選択
    const backups = await BackupService.listBackups();

    const mappingChoices: Array<{ label: string; description: string; mappingPath: string }> = [];

    // バックアップからのマッピング
    for (const backup of backups.slice(0, 5)) {
      const backupDir = BackupService.getBackupDirectory();
      const mappingPath = path.join(backupDir, `${backup.projectName}_${backup.id}`, 'metadata.json');

      // pseudonymized folderのmapping.jsonを使用
      if (await MappingStorage.mappingExists(backup.pseudonymizedPath)) {
        mappingChoices.push({
          label: `$(archive) ${backup.projectName}`,
          description: `${new Date(backup.createdAt).toLocaleString()} - ${backup.pseudonymizedPath}`,
          mappingPath: MappingStorage.getMappingPath(backup.pseudonymizedPath),
        });
      }
    }

    // カスタムマッピングファイル選択オプション
    mappingChoices.push({
      label: '$(file) mapping.jsonを選択...',
      description: 'カスタムマッピングファイルを指定',
      mappingPath: '',
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
  ctx: FileCommandContext,
  filePath: string,
  mapping: import('../types').SessionMapping
): Promise<number> {
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
 * .claudeignoreを生成
 * 元フォルダ（個人情報を含む）をClaudeから隠す
 */
async function generateClaudeignore(
  originalFolder: string,
  outputFolder: string
): Promise<void> {
  try {
    // 出力フォルダの親ディレクトリに.claudeignoreを作成
    const outputParent = path.dirname(outputFolder);
    const claudeignorePath = path.join(outputParent, '.claudeignore');

    // 元フォルダの相対パス
    const originalRelative = path.relative(outputParent, originalFolder);

    // 既存の.claudeignoreを読み込み
    let existingContent = '';
    try {
      existingContent = await fs.promises.readFile(claudeignorePath, 'utf-8');
    } catch {
      // ファイルが存在しない場合は新規作成
    }

    // 既にエントリがあるかチェック
    const lines = existingContent.split('\n').filter(line => line.trim());
    const entry = originalRelative + '/';

    if (!lines.includes(entry) && !lines.includes(originalRelative)) {
      // エントリを追加
      const header = '# DataAirlock: 仮名化前の個人情報フォルダ（Claudeからアクセス不可）\n';
      const newContent = existingContent
        ? existingContent.trimEnd() + '\n' + entry + '\n'
        : header + entry + '\n';

      await fs.promises.writeFile(claudeignorePath, newContent, 'utf-8');
    }
  } catch (error) {
    console.error('DataAirlock: .claudeignore生成エラー:', error);
  }
}
