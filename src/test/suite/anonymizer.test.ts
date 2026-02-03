/**
 * 匿名化・復元エンジンのテスト
 */

import * as assert from 'assert';
import { PIIDetector } from '../../core/piiDetector';
import { Anonymizer } from '../../core/anonymizer';
import { Deanonymizer } from '../../core/deanonymizer';
import { DEFAULT_PATTERNS } from '../../core/patternRegistry';
import { PIIType, SessionMapping } from '../../types';

suite('Anonymizer Test Suite', () => {
  let detector: PIIDetector;
  let anonymizer: Anonymizer;
  let deanonymizer: Deanonymizer;

  /**
   * 空のマッピングを作成するヘルパー関数
   */
  function createEmptyMapping(): SessionMapping {
    return {
      entries: new Map(),
      reverseIndex: new Map(),
      counters: new Map(),
    };
  }

  setup(() => {
    detector = new PIIDetector(DEFAULT_PATTERNS);
    anonymizer = new Anonymizer();
    deanonymizer = new Deanonymizer();
  });

  suite('匿名化', () => {
    test('電話番号を匿名化', () => {
      const text = '電話番号: 03-1234-5678';
      const mapping = createEmptyMapping();
      const matches = detector.detect(text);
      const { result, newEntries } = anonymizer.anonymize(
        text,
        matches,
        mapping,
        'test://doc'
      );

      assert.ok(result.includes('[PHONE_001]'));
      assert.strictEqual(newEntries.length, 1);
      assert.strictEqual(newEntries[0].type, PIIType.PHONE);
      assert.strictEqual(newEntries[0].original, '03-1234-5678');
    });

    test('メールアドレスを匿名化', () => {
      const text = 'メール: test@example.com';
      const mapping = createEmptyMapping();
      const matches = detector.detect(text);
      const { result, newEntries } = anonymizer.anonymize(
        text,
        matches,
        mapping,
        'test://doc'
      );

      assert.ok(result.includes('[EMAIL_001]'));
      assert.strictEqual(newEntries.length, 1);
      assert.strictEqual(newEntries[0].type, PIIType.EMAIL);
    });

    test('複数のPIIを匿名化', () => {
      const text = '連絡先: 03-1234-5678, test@example.com';
      const mapping = createEmptyMapping();
      const matches = detector.detect(text);
      const { result, newEntries } = anonymizer.anonymize(
        text,
        matches,
        mapping,
        'test://doc'
      );

      assert.ok(result.includes('[PHONE_001]'));
      assert.ok(result.includes('[EMAIL_001]'));
      assert.strictEqual(newEntries.length, 2);
    });

    test('同じ値は同じプレースホルダーを使用（重複排除）', () => {
      const text = '電話1: 03-1234-5678, 電話2: 03-1234-5678';
      const mapping = createEmptyMapping();

      // 最初の匿名化
      const matches1 = detector.detect(text);
      const { newEntries: entries1 } = anonymizer.anonymize(
        text,
        matches1,
        mapping,
        'test://doc'
      );

      // マッピングに追加
      for (const entry of entries1) {
        mapping.entries.set(entry.placeholder, entry);
        mapping.reverseIndex.set(entry.original, entry.placeholder);
      }

      // 2回目の匿名化（同じ値）
      const text2 = '電話3: 03-1234-5678';
      const matches2 = detector.detect(text2);
      const { result: result2, newEntries: entries2 } = anonymizer.anonymize(
        text2,
        matches2,
        mapping,
        'test://doc'
      );

      // 既存のマッピングを使用するため、新規エントリは0
      assert.strictEqual(entries2.length, 0);
      assert.ok(result2.includes('[PHONE_001]'));
    });

    suite('YAMLクォート処理', () => {
      test('値がプレースホルダーから始まる場合は値全体をクォート（構文エラー回避）', () => {
        const text = '担当者: 田中太郎（放射線診断）';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, '担当者: "[NAME_001]（放射線診断）"');
        assert.ok(!result.includes('""[NAME_001]"'), 'プレースホルダーだけにクォートを付けない');
      });

      test('既にクォートされている値はそのまま（追加クォートしない）', () => {
        const text = '担当者: "田中太郎（放射線診断）"';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, '担当者: "[NAME_001]（放射線診断）"');
      });

      test('flow sequence の要素がプレースホルダーから始まる場合は要素をクォート（型崩れ防止）', () => {
        const text = 'names: [田中太郎, 鈴木花子]';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'names: ["[NAME_001]", "[NAME_002]"]');
      });

      test('値の途中に現れるプレースホルダーはクォートしない（プレーンスカラーとして安全）', () => {
        const text = 'note: 患者は田中太郎です';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'note: 患者は[NAME_001]です');
      });

      test('インラインコメントを保持して値だけをクォート', () => {
        const text = 'name: 田中太郎 # コメント';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'name: "[NAME_001]" # コメント');
      });

      test('ブロックスカラー(|/>)の内容行はクォートしない', () => {
        const text = 'notes: |\n  田中太郎（放射線診断）';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'notes: |\n  [NAME_001]（放射線診断）');
      });

      test('キーがプレースホルダーから始まる場合はキーのみをクォート', () => {
        const text = '田中太郎: value';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, '"[NAME_001]": value');
      });

      test('flow mapping の値がプレースホルダーから始まる場合は値をクォート', () => {
        const text = 'person: {name: 田中太郎, phone: 090-1234-5678}';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'person: {name: "[NAME_001]", phone: "[PHONE_001]"}');
      });

      test('プレースホルダー単体の値もクォート', () => {
        const text = 'name: 田中太郎';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'name: "[NAME_001]"');
      });

      test('リスト要素がプレースホルダーから始まる場合は要素をクォート', () => {
        const text = '- 田中太郎（担当者）';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, '- "[NAME_001]（担当者）"');
      });

      test('isYamlFile=false の場合はクォートしない', () => {
        const text = 'name: 田中太郎';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          false
        );

        assert.strictEqual(result, 'name: [NAME_001]');
      });

      test('エスケープが必要な文字を含む値のクォート', () => {
        const text = 'note: 田中太郎 said "hello"';
        const mapping = createEmptyMapping();
        const matches = detector.detect(text);
        const { result } = anonymizer.anonymize(
          text,
          matches,
          mapping,
          'test://doc',
          true
        );

        assert.strictEqual(result, 'note: "[NAME_001] said \\"hello\\""');
      });
    });
  });

  suite('復元', () => {
    test('プレースホルダーを復元', () => {
      const mapping = createEmptyMapping();
      mapping.entries.set('[PHONE_001]', {
        placeholder: '[PHONE_001]',
        original: '03-1234-5678',
        type: PIIType.PHONE,
        documentUri: 'test://doc',
        createdAt: Date.now(),
      });

      const text = '電話番号: [PHONE_001]';
      const result = deanonymizer.deanonymize(text, mapping);

      assert.strictEqual(result, '電話番号: 03-1234-5678');
    });

    test('複数のプレースホルダーを復元', () => {
      const mapping = createEmptyMapping();
      mapping.entries.set('[PHONE_001]', {
        placeholder: '[PHONE_001]',
        original: '03-1234-5678',
        type: PIIType.PHONE,
        documentUri: 'test://doc',
        createdAt: Date.now(),
      });
      mapping.entries.set('[EMAIL_001]', {
        placeholder: '[EMAIL_001]',
        original: 'test@example.com',
        type: PIIType.EMAIL,
        documentUri: 'test://doc',
        createdAt: Date.now(),
      });

      const text = '連絡先: [PHONE_001], [EMAIL_001]';
      const result = deanonymizer.deanonymize(text, mapping);

      assert.strictEqual(result, '連絡先: 03-1234-5678, test@example.com');
    });

    test('マッピングにないプレースホルダーはそのまま残す', () => {
      const mapping = createEmptyMapping();
      const text = '電話番号: [PHONE_999]';
      const result = deanonymizer.deanonymize(text, mapping);

      assert.strictEqual(result, '電話番号: [PHONE_999]');
    });
  });

  suite('ラウンドトリップ', () => {
    test('匿名化→復元で元のテキストに戻る', () => {
      const originalText = '連絡先: 03-1234-5678, test@example.com';
      const mapping = createEmptyMapping();

      // 匿名化
      const matches = detector.detect(originalText);
      const { result: anonymized, newEntries } = anonymizer.anonymize(
        originalText,
        matches,
        mapping,
        'test://doc'
      );

      // マッピングに追加
      for (const entry of newEntries) {
        mapping.entries.set(entry.placeholder, entry);
      }

      // 復元
      const restored = deanonymizer.deanonymize(anonymized, mapping);

      assert.strictEqual(restored, originalText);
    });

    test('日本語を含むテキストのラウンドトリップ', () => {
      const originalText = '患者: 山田太郎さん、連絡先: 090-1234-5678';
      const mapping = createEmptyMapping();

      // 匿名化
      const matches = detector.detect(originalText);
      const { result: anonymized, newEntries } = anonymizer.anonymize(
        originalText,
        matches,
        mapping,
        'test://doc'
      );

      // マッピングに追加
      for (const entry of newEntries) {
        mapping.entries.set(entry.placeholder, entry);
      }

      // 復元
      const restored = deanonymizer.deanonymize(anonymized, mapping);

      assert.strictEqual(restored, originalText);
    });
  });
});
