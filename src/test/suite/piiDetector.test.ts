/**
 * PII検出エンジンのテスト
 */

import * as assert from 'assert';
import { PIIDetector } from '../../core/piiDetector';
import { DEFAULT_PATTERNS } from '../../core/patternRegistry';
import { PIIType } from '../../types';

suite('PIIDetector Test Suite', () => {
  let detector: PIIDetector;

  setup(() => {
    // 各テスト前にdetectorを初期化
    detector = new PIIDetector(DEFAULT_PATTERNS);
  });

  suite('電話番号検出', () => {
    test('固定電話（ハイフンあり）を検出', () => {
      const text = '電話番号: 03-1234-5678';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.PHONE);
      assert.strictEqual(matches[0].value, '03-1234-5678');
    });

    test('携帯電話（ハイフンあり）を検出', () => {
      const text = '携帯: 090-1234-5678';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.PHONE);
      assert.strictEqual(matches[0].value, '090-1234-5678');
    });

    test('電話番号（ハイフンなし）を検出', () => {
      const text = 'TEL: 09012345678';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.PHONE);
      assert.strictEqual(matches[0].value, '09012345678');
    });
  });

  suite('メールアドレス検出', () => {
    test('標準的なメールアドレスを検出', () => {
      const text = '連絡先: test@example.com';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.EMAIL);
      assert.strictEqual(matches[0].value, 'test@example.com');
    });

    test('サブドメイン付きメールアドレスを検出', () => {
      const text = 'email: user@mail.example.co.jp';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.EMAIL);
    });
  });

  suite('マイナンバー検出', () => {
    test('ハイフン区切りのマイナンバーを検出', () => {
      const text = 'マイナンバー: 1234-5678-9012';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.MYNUMBER);
      assert.strictEqual(matches[0].value, '1234-5678-9012');
    });

    test('12桁連続のマイナンバーを検出', () => {
      const text = '個人番号: 123456789012';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.MYNUMBER);
    });
  });

  suite('生年月日検出', () => {
    test('西暦（スラッシュ区切り）を検出', () => {
      const text = '生年月日: 1990/01/15';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.DOB);
      assert.strictEqual(matches[0].value, '1990/01/15');
    });

    test('西暦（日本語）を検出', () => {
      const text = '生まれ: 1990年1月15日';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.DOB);
    });

    test('和暦を検出', () => {
      const text = '誕生日: 平成2年1月15日';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.DOB);
    });
  });

  suite('住所検出', () => {
    test('郵便番号を検出', () => {
      const text = '〒160-0023';
      const matches = detector.detect(text);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].type, PIIType.ADDRESS);
    });

    test('都道府県から始まる住所を検出', () => {
      const text = '住所: 東京都新宿区西新宿1-1-1';
      const matches = detector.detect(text);

      assert.ok(matches.length >= 1);
      const addressMatch = matches.find((m) => m.type === PIIType.ADDRESS);
      assert.ok(addressMatch);
    });
  });

  suite('複数PII検出', () => {
    test('複数種類のPIIを検出', () => {
      const text = '山田太郎さんの電話番号は03-1234-5678、メールはtest@example.comです。';
      const matches = detector.detect(text);

      // 電話番号とメールアドレスが検出されるはず
      const phoneMatch = matches.find((m) => m.type === PIIType.PHONE);
      const emailMatch = matches.find((m) => m.type === PIIType.EMAIL);

      assert.ok(phoneMatch, '電話番号が検出されるべき');
      assert.ok(emailMatch, 'メールアドレスが検出されるべき');
    });
  });

  suite('重複防止', () => {
    test('重複するマッチを除外', () => {
      const text = 'テスト: 123456789012';
      const matches = detector.detect(text);

      // 同じ位置に複数のマッチがないことを確認
      for (let i = 0; i < matches.length - 1; i++) {
        assert.ok(
          matches[i].endIndex <= matches[i + 1].startIndex,
          'マッチが重複していないべき'
        );
      }
    });
  });
});
