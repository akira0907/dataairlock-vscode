/**
 * VSCode Extension テストランナー
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // 拡張機能の開発パス
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // テストスイートのパス
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // テストを実行
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
