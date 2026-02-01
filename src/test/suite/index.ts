/**
 * テストスイートのエントリポイント
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // Mochaインスタンスを作成
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname, '.');

  // テストファイルを検索
  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // テストファイルをMochaに追加
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  // テストを実行
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
