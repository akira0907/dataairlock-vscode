/**
 * ファイル・フォルダ単位の仮名化/復元処理
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PIIDetector } from '../core/piiDetector';
import { Anonymizer } from '../core/anonymizer';
import { Deanonymizer } from '../core/deanonymizer';
import { SessionMapping, MappingEntry, PIIType } from '../types';
import { MappingStorage } from './mappingStorage';

/**
 * 名前の正規化（スペースを除去して比較用のキーを生成）
 */
function normalizeNameForLookup(value: string, type: PIIType): string {
  if (type === PIIType.NAME) {
    return value.replace(/[\s　]+/g, '');
  }
  return value;
}

/**
 * YAMLファイルかどうかを判定
 */
function isYamlFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.yaml' || ext === '.yml';
}

/**
 * 処理結果
 */
export interface ProcessResult {
  success: boolean;
  filesProcessed: number;
  piiFound: number;
  outputPath: string;
  mappingPath?: string;
  errors: string[];
}

/**
 * ファイルプロセッサクラス
 */
export class FileProcessor {
  constructor(
    private detector: PIIDetector,
    private anonymizer: Anonymizer,
    private deanonymizer: Deanonymizer
  ) {}

  /**
   * 対象ファイル拡張子を取得
   */
  private getTargetExtensions(): string[] {
    const config = vscode.workspace.getConfiguration('dataairlock');
    return config.get<string[]>('fileExtensions', [
      '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log',
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
      '.rb', '.go', '.rs', '.swift', '.xlsx', '.xls', '.yaml', '.yml'
    ]);
  }

  /**
   * airlockベースパスを取得（ワークスペースルート/airlock）
   */
  private getAirlockBasePath(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('ワークスペースが開かれていません');
    }
    const config = vscode.workspace.getConfiguration('dataairlock');
    const airlockFolderName = config.get<string>('airlockFolderName', 'airlock');
    return path.join(workspaceFolders[0].uri.fsPath, airlockFolderName);
  }

  /**
   * ソースフォルダからairlock出力パスを計算
   */
  getAirlockOutputPath(sourceFolder: string): string {
    const folderName = path.basename(sourceFolder);
    return path.join(this.getAirlockBasePath(), folderName);
  }

  /**
   * ファイルが処理対象かチェック
   */
  private isTargetFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.getTargetExtensions().includes(ext);
  }

  /**
   * 単一ファイルを仮名化
   */
  async anonymizeFile(
    sourcePath: string,
    outputFolder?: string
  ): Promise<ProcessResult> {
    const errors: string[] = [];
    let piiFound = 0;

    try {
      // 出力先フォルダを決定
      const sourceDir = path.dirname(sourcePath);
      const sourceFileName = path.basename(sourcePath);
      const parentFolderName = path.basename(sourceDir);
      const outputDir = outputFolder || path.join(this.getAirlockBasePath(), parentFolderName);

      // 出力フォルダを作成
      await fs.promises.mkdir(outputDir, { recursive: true });

      // ファイルを読み込み
      const content = await fs.promises.readFile(sourcePath, 'utf-8');

      // マッピングを初期化
      const mapping: SessionMapping = {
        entries: new Map(),
        reverseIndex: new Map(),
        counters: new Map(),
      };

      // PII検出
      const matches = this.detector.detect(content);
      piiFound = matches.length;

      let outputContent = content;
      if (matches.length > 0) {
        // 仮名化（YAMLファイルの場合はクォート処理を有効化）
        const { result, newEntries } = this.anonymizer.anonymize(
          content,
          matches,
          mapping,
          sourcePath,
          isYamlFile(sourcePath)
        );
        outputContent = result;

        // マッピングに追加（正規化した値も登録）
        for (const entry of newEntries) {
          mapping.entries.set(entry.placeholder, entry);
          mapping.reverseIndex.set(entry.original, entry.placeholder);
          const normalizedValue = normalizeNameForLookup(entry.original, entry.type as PIIType);
          if (normalizedValue !== entry.original) {
            mapping.reverseIndex.set(normalizedValue, entry.placeholder);
          }
        }
      }

      // 出力ファイルを保存
      const outputPath = path.join(outputDir, sourceFileName);
      await fs.promises.writeFile(outputPath, outputContent, 'utf-8');

      // マッピングを保存
      let mappingPath: string | undefined;
      if (mapping.entries.size > 0) {
        mappingPath = await MappingStorage.saveMapping(
          outputDir,
          sourceDir,
          mapping
        );
      }

      return {
        success: true,
        filesProcessed: 1,
        piiFound,
        outputPath: outputDir,
        mappingPath,
        errors,
      };
    } catch (error) {
      errors.push(`Error processing ${sourcePath}: ${error}`);
      return {
        success: false,
        filesProcessed: 0,
        piiFound: 0,
        outputPath: '',
        errors,
      };
    }
  }

  /**
   * フォルダを再帰的に仮名化
   */
  async anonymizeFolder(
    sourceFolder: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    customOutputPath?: string
  ): Promise<ProcessResult> {
    const errors: string[] = [];
    let filesProcessed = 0;
    let totalPiiFound = 0;

    try {
      // 出力フォルダを作成（airlock/フォルダ名）
      const folderName = path.basename(sourceFolder);
      const outputFolder = customOutputPath || path.join(this.getAirlockBasePath(), folderName);
      await fs.promises.mkdir(outputFolder, { recursive: true });

      // 全ファイルを取得
      const files = await this.getAllFiles(sourceFolder);
      const targetFiles = files.filter((f) => this.isTargetFile(f));

      if (targetFiles.length === 0) {
        return {
          success: true,
          filesProcessed: 0,
          piiFound: 0,
          outputPath: outputFolder,
          errors: ['対象ファイルが見つかりませんでした'],
        };
      }

      // 既存のmappingがあれば読み込んで再利用（同じ値には同じプレースホルダーを使用）
      let mapping: SessionMapping;
      const existingMappingExists = await MappingStorage.mappingExists(outputFolder);
      if (existingMappingExists) {
        const mappingPath = await MappingStorage.getMappingPathAsync(outputFolder);
        mapping = await MappingStorage.loadMapping(mappingPath);
      } else {
        mapping = {
          entries: new Map(),
          reverseIndex: new Map(),
          counters: new Map(),
        };
      }

      const incrementPerFile = 100 / targetFiles.length;

      for (const filePath of targetFiles) {
        try {
          // 相対パスを計算
          const relativePath = path.relative(sourceFolder, filePath);
          const outputPath = path.join(outputFolder, relativePath);

          // 出力ディレクトリを作成
          await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

          // ファイルを読み込み
          const content = await fs.promises.readFile(filePath, 'utf-8');

          // PII検出
          const matches = this.detector.detect(content);
          totalPiiFound += matches.length;

          let outputContent = content;
          if (matches.length > 0) {
            // 仮名化（YAMLファイルの場合はクォート処理を有効化）
            const { result, newEntries } = this.anonymizer.anonymize(
              content,
              matches,
              mapping,
              filePath,
              isYamlFile(filePath)
            );
            outputContent = result;

            // マッピングに追加（正規化した値も登録して同一人物の統一を図る）
            for (const entry of newEntries) {
              mapping.entries.set(entry.placeholder, entry);
              mapping.reverseIndex.set(entry.original, entry.placeholder);
              // 名前の場合は正規化した値（スペース除去）も登録
              const normalizedValue = normalizeNameForLookup(entry.original, entry.type as PIIType);
              if (normalizedValue !== entry.original) {
                mapping.reverseIndex.set(normalizedValue, entry.placeholder);
              }
            }
          }

          // 出力ファイルを保存
          await fs.promises.writeFile(outputPath, outputContent, 'utf-8');
          filesProcessed++;

          // 進捗を報告
          if (progress) {
            progress.report({
              message: `${filesProcessed}/${targetFiles.length} files`,
              increment: incrementPerFile,
            });
          }
        } catch (error) {
          errors.push(`Error processing ${filePath}: ${error}`);
        }
      }

      // マッピングを保存
      let mappingPath: string | undefined;
      if (mapping.entries.size > 0) {
        mappingPath = await MappingStorage.saveMapping(
          outputFolder,
          sourceFolder,
          mapping
        );
      }

      return {
        success: errors.length === 0,
        filesProcessed,
        piiFound: totalPiiFound,
        outputPath: outputFolder,
        mappingPath,
        errors,
      };
    } catch (error) {
      errors.push(`Error processing folder: ${error}`);
      return {
        success: false,
        filesProcessed: 0,
        piiFound: 0,
        outputPath: '',
        errors,
      };
    }
  }

  /**
   * 単一ファイルを復元
   */
  async deanonymizeFile(
    sourcePath: string,
    mappingPath?: string
  ): Promise<ProcessResult> {
    const errors: string[] = [];

    try {
      // マッピングファイルを探す
      const sourceDir = path.dirname(sourcePath);
      const actualMappingPath = mappingPath ||
        await MappingStorage.getMappingPathAsync(sourceDir);

      // マッピングを読み込み
      const mapping = await MappingStorage.loadMapping(actualMappingPath);

      // ファイルを読み込み
      const content = await fs.promises.readFile(sourcePath, 'utf-8');

      // プレースホルダーを検出
      const placeholders = this.deanonymizer.findPlaceholders(content);

      if (placeholders.length === 0) {
        return {
          success: true,
          filesProcessed: 1,
          piiFound: 0,
          outputPath: sourcePath,
          errors: ['プレースホルダーが見つかりませんでした'],
        };
      }

      // 復元
      const restored = this.deanonymizer.deanonymize(content, mapping);

      // 元ファイルを上書き
      await fs.promises.writeFile(sourcePath, restored, 'utf-8');

      return {
        success: true,
        filesProcessed: 1,
        piiFound: placeholders.length,
        outputPath: sourcePath,
        errors,
      };
    } catch (error) {
      errors.push(`Error restoring ${sourcePath}: ${error}`);
      return {
        success: false,
        filesProcessed: 0,
        piiFound: 0,
        outputPath: '',
        errors,
      };
    }
  }

  /**
   * フォルダを再帰的に復元
   */
  async deanonymizeFolder(
    folderPath: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<ProcessResult> {
    const errors: string[] = [];
    let filesProcessed = 0;
    let totalRestored = 0;

    try {
      // マッピングを読み込み
      const mappingPath = await MappingStorage.getMappingPathAsync(folderPath);
      const mapping = await MappingStorage.loadMapping(mappingPath);

      // 全ファイルを取得
      const files = await this.getAllFiles(folderPath);
      const targetFiles = files.filter((f) => this.isTargetFile(f));

      if (targetFiles.length === 0) {
        return {
          success: true,
          filesProcessed: 0,
          piiFound: 0,
          outputPath: folderPath,
          errors: ['対象ファイルが見つかりませんでした'],
        };
      }

      const incrementPerFile = 100 / targetFiles.length;

      for (const filePath of targetFiles) {
        try {
          // ファイルを読み込み
          const content = await fs.promises.readFile(filePath, 'utf-8');

          // プレースホルダーを検出
          const placeholders = this.deanonymizer.findPlaceholders(content);

          if (placeholders.length > 0) {
            // 復元
            const restored = this.deanonymizer.deanonymize(content, mapping);

            // ファイルを上書き
            await fs.promises.writeFile(filePath, restored, 'utf-8');
            totalRestored += placeholders.length;
          }

          filesProcessed++;

          // 進捗を報告
          if (progress) {
            progress.report({
              message: `${filesProcessed}/${targetFiles.length} files`,
              increment: incrementPerFile,
            });
          }
        } catch (error) {
          errors.push(`Error restoring ${filePath}: ${error}`);
        }
      }

      // airlock方式ではフォルダ名のリネームは不要
      // （元のフォルダ名がそのまま使用される）

      return {
        success: errors.length === 0,
        filesProcessed,
        piiFound: totalRestored,
        outputPath: folderPath,
        errors,
      };
    } catch (error) {
      errors.push(`Error processing folder: ${error}`);
      return {
        success: false,
        filesProcessed: 0,
        piiFound: 0,
        outputPath: '',
        errors,
      };
    }
  }

  /**
   * フォルダ内の全ファイルを再帰的に取得
   */
  private async getAllFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // mapping.jsonはスキップ
      if (entry.name === 'mapping.json') {
        continue;
      }

      if (entry.isDirectory()) {
        // サブディレクトリを再帰的に処理
        const subFiles = await this.getAllFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
