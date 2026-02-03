/**
 * MappingStorage のテスト
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MappingStorage } from '../../services/mappingStorage';

suite('MappingStorage Test Suite', () => {
  test('getMappingPathAsync resolves mapping from nested folder (airlock/.mapping/<SOURCE>.json)', async () => {
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dataairlock-mapping-'));
    try {
      const airlockBase = path.join(tmpRoot, 'airlock');
      const sourceName = 'project';
      const outputFolder = path.join(airlockBase, sourceName);
      const nestedFolder = path.join(outputFolder, 'sub', 'deep');
      const mappingDir = path.join(airlockBase, '.mapping');
      const mappingPath = path.join(mappingDir, `${sourceName}.json`);

      await fs.promises.mkdir(nestedFolder, { recursive: true });
      await fs.promises.mkdir(mappingDir, { recursive: true });
      await fs.promises.writeFile(mappingPath, JSON.stringify({ entries: [] }), 'utf-8');

      const resolved = await MappingStorage.getMappingPathAsync(nestedFolder);
      assert.strictEqual(resolved, mappingPath);

      const exists = await MappingStorage.mappingExists(nestedFolder);
      assert.strictEqual(exists, true);
    } finally {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test('getMappingPathAsync resolves legacy mapping.json in folder', async () => {
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dataairlock-mapping-'));
    try {
      const folder = path.join(tmpRoot, 'someFolder');
      await fs.promises.mkdir(folder, { recursive: true });
      const legacyPath = path.join(folder, 'mapping.json');
      await fs.promises.writeFile(legacyPath, JSON.stringify({ entries: [] }), 'utf-8');

      const resolved = await MappingStorage.getMappingPathAsync(folder);
      assert.strictEqual(resolved, legacyPath);

      const exists = await MappingStorage.mappingExists(folder);
      assert.strictEqual(exists, true);
    } finally {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

