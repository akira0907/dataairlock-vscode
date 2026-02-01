/**
 * 元データのバックアップ管理サービス
 * 仮名化前のデータを安全な場所に退避し、復元時に利用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * バックアップメタデータ
 */
export interface BackupMetadata {
  /** バックアップID */
  id: string;
  /** 元のパス */
  originalPath: string;
  /** バックアップ日時 */
  createdAt: string;
  /** 仮名化出力先 */
  pseudonymizedPath: string;
  /** ファイル数 */
  fileCount: number;
  /** プロジェクト名 */
  projectName: string;
}

/**
 * バックアップ一覧
 */
export interface BackupRegistry {
  backups: BackupMetadata[];
}

/**
 * バックアップサービス
 */
export class BackupService {
  private static readonly REGISTRY_FILE = 'registry.json';

  /**
   * バックアップディレクトリを取得
   */
  static getBackupDirectory(): string {
    const config = vscode.workspace.getConfiguration('dataairlock');
    let backupDir = config.get<string>('backupDirectory', '~/DataAirlock/backups');

    // ~ をホームディレクトリに展開
    if (backupDir.startsWith('~')) {
      backupDir = path.join(os.homedir(), backupDir.slice(1));
    }

    return backupDir;
  }

  /**
   * バックアップIDを生成
   */
  private static generateBackupId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return timestamp;
  }

  /**
   * レジストリを読み込み
   */
  private static async loadRegistry(): Promise<BackupRegistry> {
    const backupDir = this.getBackupDirectory();
    const registryPath = path.join(backupDir, this.REGISTRY_FILE);

    try {
      const content = await fs.promises.readFile(registryPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { backups: [] };
    }
  }

  /**
   * レジストリを保存
   */
  private static async saveRegistry(registry: BackupRegistry): Promise<void> {
    const backupDir = this.getBackupDirectory();
    await fs.promises.mkdir(backupDir, { recursive: true });

    const registryPath = path.join(backupDir, this.REGISTRY_FILE);
    await fs.promises.writeFile(
      registryPath,
      JSON.stringify(registry, null, 2),
      'utf-8'
    );
  }

  /**
   * フォルダをバックアップ（移動）
   */
  static async backupFolder(
    sourcePath: string,
    pseudonymizedPath: string
  ): Promise<BackupMetadata | null> {
    try {
      const backupDir = this.getBackupDirectory();
      const backupId = this.generateBackupId();
      const projectName = path.basename(sourcePath);

      // バックアップ先パスを作成
      const backupPath = path.join(backupDir, `${projectName}_${backupId}`);

      // バックアップディレクトリを作成
      await fs.promises.mkdir(backupPath, { recursive: true });

      // ファイルを移動（コピーして削除）
      const fileCount = await this.moveDirectory(sourcePath, backupPath);

      // メタデータを作成
      const metadata: BackupMetadata = {
        id: backupId,
        originalPath: sourcePath,
        createdAt: new Date().toISOString(),
        pseudonymizedPath,
        fileCount,
        projectName,
      };

      // メタデータをバックアップフォルダにも保存
      await fs.promises.writeFile(
        path.join(backupPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
      );

      // レジストリに追加
      const registry = await this.loadRegistry();
      registry.backups.push(metadata);
      await this.saveRegistry(registry);

      return metadata;
    } catch (error) {
      console.error('BackupService: バックアップエラー:', error);
      return null;
    }
  }

  /**
   * ディレクトリを移動（コピーして削除）
   */
  private static async moveDirectory(
    src: string,
    dest: string
  ): Promise<number> {
    let fileCount = 0;
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        fileCount += await this.moveDirectory(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
        fileCount++;
      }
    }

    // 元ディレクトリを削除
    await fs.promises.rm(src, { recursive: true, force: true });

    return fileCount;
  }

  /**
   * バックアップからデータを復元
   */
  static async restoreFromBackup(backupId: string): Promise<boolean> {
    try {
      const registry = await this.loadRegistry();
      const backup = registry.backups.find(b => b.id === backupId);

      if (!backup) {
        throw new Error(`バックアップが見つかりません: ${backupId}`);
      }

      const backupDir = this.getBackupDirectory();
      const backupPath = path.join(backupDir, `${backup.projectName}_${backupId}`);

      // バックアップが存在するか確認
      try {
        await fs.promises.access(backupPath);
      } catch {
        throw new Error(`バックアップフォルダが存在しません: ${backupPath}`);
      }

      // 元の場所に復元
      await fs.promises.mkdir(backup.originalPath, { recursive: true });
      await this.copyDirectory(backupPath, backup.originalPath, ['metadata.json']);

      return true;
    } catch (error) {
      console.error('BackupService: 復元エラー:', error);
      return false;
    }
  }

  /**
   * ディレクトリをコピー
   */
  private static async copyDirectory(
    src: string,
    dest: string,
    excludeFiles: string[] = []
  ): Promise<void> {
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (excludeFiles.includes(entry.name)) {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        await this.copyDirectory(srcPath, destPath, excludeFiles);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 特定のパスに関連するバックアップを検索
   */
  static async findBackupByPseudonymizedPath(
    pseudonymizedPath: string
  ): Promise<BackupMetadata | null> {
    const registry = await this.loadRegistry();

    // 正規化して比較
    const normalizedPath = path.resolve(pseudonymizedPath);

    return registry.backups.find(b =>
      path.resolve(b.pseudonymizedPath) === normalizedPath
    ) || null;
  }

  /**
   * バックアップ一覧を取得
   */
  static async listBackups(): Promise<BackupMetadata[]> {
    const registry = await this.loadRegistry();
    return registry.backups.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * バックアップを削除
   */
  static async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const registry = await this.loadRegistry();
      const backupIndex = registry.backups.findIndex(b => b.id === backupId);

      if (backupIndex === -1) {
        return false;
      }

      const backup = registry.backups[backupIndex];
      const backupDir = this.getBackupDirectory();
      const backupPath = path.join(backupDir, `${backup.projectName}_${backupId}`);

      // バックアップフォルダを削除
      try {
        await fs.promises.rm(backupPath, { recursive: true, force: true });
      } catch {
        // フォルダが既に存在しない場合は無視
      }

      // レジストリから削除
      registry.backups.splice(backupIndex, 1);
      await this.saveRegistry(registry);

      return true;
    } catch (error) {
      console.error('BackupService: 削除エラー:', error);
      return false;
    }
  }
}
