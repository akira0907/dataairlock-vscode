/**
 * ファイル・フォルダ単位の仮名化/復元処理
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PIIDetector } from '../core/piiDetector';
import { Anonymizer } from '../core/anonymizer';
import { Deanonymizer } from '../core/deanonymizer';
import { SessionMapping, MappingEntry } from '../types';
import { MappingStorage } from './mappingStorage';

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
      '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log'
    ]);
  }

  /**
   * 出力フォルダサフィックスを取得
   */
  private getOutputSuffix(): string {
    const config = vscode.workspace.getConfiguration('dataairlock');
    return config.get<string>('outputFolderSuffix', '_anonymized');
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
      const outputDir = outputFolder || sourceDir + this.getOutputSuffix();

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
        // 仮名化
        const { result, newEntries } = this.anonymizer.anonymize(
          content,
          matches,
          mapping,
          sourcePath
        );
        outputContent = result;

        // マッピングに追加
        for (const entry of newEntries) {
          mapping.entries.set(entry.placeholder, entry);
          mapping.reverseIndex.set(entry.original, entry.placeholder);
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
      // 出力フォルダを作成
      const outputFolder = customOutputPath || (sourceFolder + this.getOutputSuffix());
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

      // 共通マッピングを使用
      const mapping: SessionMapping = {
        entries: new Map(),
        reverseIndex: new Map(),
        counters: new Map(),
      };

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
            // 仮名化
            const { result, newEntries } = this.anonymizer.anonymize(
              content,
              matches,
              mapping,
              filePath
            );
            outputContent = result;

            // マッピングに追加
            for (const entry of newEntries) {
              mapping.entries.set(entry.placeholder, entry);
              mapping.reverseIndex.set(entry.original, entry.placeholder);
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
      const actualMappingPath =
        mappingPath || MappingStorage.getMappingPath(sourceDir);

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
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    renameFolder: boolean = true
  ): Promise<ProcessResult> {
    const errors: string[] = [];
    let filesProcessed = 0;
    let totalRestored = 0;

    try {
      // マッピングを読み込み
      const mappingPath = MappingStorage.getMappingPath(folderPath);
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

      // フォルダ名を変更（_pseudonymized → _restored）
      let finalOutputPath = folderPath;
      if (renameFolder && totalRestored > 0) {
        const suffix = this.getOutputSuffix();
        if (folderPath.endsWith(suffix)) {
          const newPath = folderPath.replace(suffix, '_restored');
          try {
            await fs.promises.rename(folderPath, newPath);
            finalOutputPath = newPath;
          } catch (renameError) {
            errors.push(`フォルダ名の変更に失敗: ${renameError}`);
          }
        }
      }

      return {
        success: errors.length === 0,
        filesProcessed,
        piiFound: totalRestored,
        outputPath: finalOutputPath,
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
