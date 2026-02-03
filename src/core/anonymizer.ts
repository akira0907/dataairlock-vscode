/**
 * 匿名化エンジン
 * 検出されたPIIをプレースホルダーに置換
 */

import { PIIType, PIIMatch, MappingEntry, SessionMapping } from '../types';

/**
 * 名前の正規化（スペースを除去して比較用のキーを生成）
 */
function normalizeNameForLookup(value: string, type: PIIType): string {
  if (type === PIIType.NAME) {
    // 全角/半角スペースを除去
    return value.replace(/[\s　]+/g, '');
  }
  return value;
}

/**
 * 匿名化クラス
 */
export class Anonymizer {
  /**
   * テキスト内のPIIをプレースホルダーに置換
   * @param text 対象テキスト
   * @param matches 検出されたPIIマッチ（位置順にソート済みであること）
   * @param mapping 既存のマッピング（重複防止用）
   * @param documentUri ドキュメントURI
   * @param isYamlFile YAMLファイルかどうか（プレースホルダーのクォート処理用）
   * @returns 置換後のテキストと新規マッピングエントリ
   */
  anonymize(
    text: string,
    matches: PIIMatch[],
    mapping: SessionMapping,
    documentUri: string,
    isYamlFile: boolean = false
  ): { result: string; newEntries: MappingEntry[] } {
    const newEntries: MappingEntry[] = [];
    let result = text;
    let offset = 0;

    for (const match of matches) {
      // 正規化した値で既存マッピングを検索（名前の場合はスペース除去）
      const normalizedValue = normalizeNameForLookup(match.value, match.type);
      let placeholder = mapping.reverseIndex.get(match.value) ||
                       mapping.reverseIndex.get(normalizedValue);

      if (!placeholder) {
        // 新しいプレースホルダーを生成
        placeholder = this.generatePlaceholder(match.type, mapping);

        // 同一呼び出し内の重複（同じ original が複数回出る）も同じプレースホルダーにするため、
        // 生成した時点で reverseIndex に登録しておく。
        mapping.reverseIndex.set(match.value, placeholder);
        if (normalizedValue !== match.value) {
          mapping.reverseIndex.set(normalizedValue, placeholder);
        }

        // 新規エントリを記録
        newEntries.push({
          placeholder,
          original: match.value,
          type: match.type,
          documentUri,
          createdAt: Date.now(),
        });
      }

      // テキスト内で置換（オフセットを考慮）
      const adjustedStart = match.startIndex + offset;

      // YAMLでも置換自体はプレースホルダーのみ（クォートは後処理で必要箇所に付与）
      const replacementValue = placeholder;

      result =
        result.slice(0, adjustedStart) +
        replacementValue +
        result.slice(adjustedStart + match.value.length);

      // オフセットを更新（置換後の長さ - 元の値の長さ）
      offset += replacementValue.length - match.value.length;
    }

    // YAMLの場合、プレースホルダーが先頭に来る値/要素をクォートして構文エラーや型崩れを防ぐ
    if (isYamlFile) {
      result = this.postProcessYaml(result);
    }

    return { result, newEntries };
  }

  /**
   * YAML向けの後処理
   * - `[TYPE_NNN]` が値/要素の先頭に来ると YAML では flow collection と解釈され得る
   * - 既存のクォート内・ブロックスカラー内は触らない
   * - 先頭がプレースホルダーのスカラーを全体クォートする（プレースホルダー単体も含む）
   */
  private postProcessYaml(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];

    let inBlockScalar = false;
    let blockIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ブロックスカラー内は内容をそのまま（プレースホルダーが先頭でも YAML 的に問題なし）
      if (inBlockScalar) {
        if (line.trim() === '') {
          out.push(line);
          continue;
        }

        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        if (indent < blockIndent) {
          inBlockScalar = false;
          // fallthrough: この行は通常処理
        } else {
          out.push(line);
          continue;
        }
      }

      // コメント行はそのまま
      if (line.trimStart().startsWith('#')) {
        out.push(line);
        continue;
      }

      // まずブロックスカラー開始行か判定（例: key: | / key: > / - | / - >）
      const blockHeaderMatch = line.match(/^(?<indent>\s*)(?:-\s+)?[^#]*:\s*[|>][0-9+-]*\s*(?:#.*)?$/);
      const listBlockHeaderMatch = line.match(/^(?<indent>\s*)-\s*[|>][0-9+-]*\s*(?:#.*)?$/);
      if (blockHeaderMatch || listBlockHeaderMatch) {
        const indent = (blockHeaderMatch?.groups?.indent ?? listBlockHeaderMatch?.groups?.indent ?? '').length;
        inBlockScalar = true;
        blockIndent = indent + 1;
        out.push(line);
        continue;
      }

      // プレースホルダーが無ければそのまま
      if (!this.containsPlaceholder(line)) {
        out.push(line);
        continue;
      }

      const { code, comment } = this.splitYamlComment(line);
      const fixedCode = this.quoteYamlScalarsStartingWithPlaceholder(code);
      out.push(fixedCode + comment);
    }

    return out.join('\n');
  }

  private containsPlaceholder(text: string): boolean {
    return /\[(NAME|PHONE|EMAIL|ADDRESS|MYNUMBER|DOB)_\d{3}\]/.test(text);
  }

  /**
   * YAMLの inline comment を分離（クォート内の `#` は無視）
   */
  private splitYamlComment(line: string): { code: string; comment: string } {
    let inSingle = false;
    let inDouble = false;
    let singleEscaped = false;
    let doubleEscaped = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inSingle) {
        if (ch === "'" && !singleEscaped) {
          if (line[i + 1] === "'") {
            singleEscaped = true;
          } else {
            inSingle = false;
          }
        } else if (ch === "'" && singleEscaped) {
          singleEscaped = false;
        }
        continue;
      }

      if (inDouble) {
        if (doubleEscaped) {
          doubleEscaped = false;
          continue;
        }
        if (ch === '\\') {
          doubleEscaped = true;
          continue;
        }
        if (ch === '"') {
          inDouble = false;
        }
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        singleEscaped = false;
        continue;
      }

      if (ch === '"') {
        inDouble = true;
        doubleEscaped = false;
        continue;
      }

      if (ch === '#') {
        // YAMLの inline comment は whitespace の後で始まるのが基本
        if (i === 0 || /\s/.test(line[i - 1])) {
          return { code: line.slice(0, i), comment: line.slice(i) };
        }
      }
    }

    return { code: line, comment: '' };
  }

  /**
   * YAMLの値/要素がプレースホルダーから始まる場合に全体をクォートする。
   * - 既にクォートされているスカラーはそのまま
   * - flow sequence/map の要素も対象（`,` または `]`/`}` まで）
   */
  private quoteYamlScalarsStartingWithPlaceholder(code: string): string {
    const placeholderRegex = /\[(NAME|PHONE|EMAIL|ADDRESS|MYNUMBER|DOB)_\d{3}\]/g;
    if (!placeholderRegex.test(code)) {
      return code;
    }
    placeholderRegex.lastIndex = 0;

    // 文字位置ごとの状態（クォート/flow ネスト）を作る
    const len = code.length;
    const inSingleAt = new Array<boolean>(len);
    const inDoubleAt = new Array<boolean>(len);
    const flowDepthAt = new Array<number>(len);
    const flowTopAt = new Array<string | null>(len);

    let inSingle = false;
    let inDouble = false;
    let singleEscaped = false;
    let doubleEscaped = false;
    const flowStack: string[] = [];

    for (let i = 0; i < len; i++) {
      inSingleAt[i] = inSingle;
      inDoubleAt[i] = inDouble;
      flowDepthAt[i] = flowStack.length;
      flowTopAt[i] = flowStack.length > 0 ? flowStack[flowStack.length - 1] : null;

      const ch = code[i];

      if (inSingle) {
        if (ch === "'" && !singleEscaped) {
          if (code[i + 1] === "'") {
            singleEscaped = true;
          } else {
            inSingle = false;
          }
        } else if (ch === "'" && singleEscaped) {
          singleEscaped = false;
        }
        continue;
      }

      if (inDouble) {
        if (doubleEscaped) {
          doubleEscaped = false;
          continue;
        }
        if (ch === '\\') {
          doubleEscaped = true;
          continue;
        }
        if (ch === '"') {
          inDouble = false;
        }
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        singleEscaped = false;
        continue;
      }

      if (ch === '"') {
        inDouble = true;
        doubleEscaped = false;
        continue;
      }

      if (ch === '[' || ch === '{') {
        flowStack.push(ch);
        continue;
      }

      if (ch === ']' || ch === '}') {
        const expected = ch === ']' ? '[' : '{';
        if (flowStack[flowStack.length - 1] === expected) {
          flowStack.pop();
        }
        continue;
      }
    }

    type Range = { start: number; end: number };
    const ranges: Range[] = [];

    const getBlockContentStart = (): number => {
      let idx = 0;
      while (idx < len && /\s/.test(code[idx])) idx++;
      if (code[idx] === '-' && (idx + 1 >= len || /\s/.test(code[idx + 1]))) {
        idx++;
        while (idx < len && /\s/.test(code[idx])) idx++;
      }
      return idx;
    };

    const findBlockMappingSeparator = (from: number): number => {
      for (let i = from; i < len; i++) {
        if (inSingleAt[i] || inDoubleAt[i]) continue;
        if (flowDepthAt[i] !== 0) continue;
        if (code[i] === ':' && (i + 1 >= len || /\s/.test(code[i + 1]))) {
          return i;
        }
      }
      return -1;
    };

    const findFlowScalarStart = (pos: number, depth: number, container: string | null): number => {
      for (let i = pos - 1; i >= 0; i--) {
        if (inSingleAt[i] || inDoubleAt[i]) continue;
        const ch = code[i];
        if (ch === ',' && flowDepthAt[i] === depth) {
          let s = i + 1;
          while (s < len && /\s/.test(code[s])) s++;
          return s;
        }
        if ((ch === '[' || ch === '{') && flowDepthAt[i] === depth - 1) {
          let s = i + 1;
          while (s < len && /\s/.test(code[s])) s++;
          return s;
        }
        if (container === '{' && ch === ':' && flowDepthAt[i] === depth) {
          let s = i + 1;
          while (s < len && /\s/.test(code[s])) s++;
          return s;
        }
      }
      return 0;
    };

    const findFlowScalarEnd = (posAfter: number, depth: number, container: string | null): number => {
      for (let i = posAfter; i < len; i++) {
        if (inSingleAt[i] || inDoubleAt[i]) continue;
        const ch = code[i];
        if (ch === ',' && flowDepthAt[i] === depth) {
          return i;
        }
        if ((ch === ']' || ch === '}') && flowDepthAt[i] === depth) {
          return i;
        }
        if (container === '{' && ch === ':' && flowDepthAt[i] === depth) {
          return i; // key end
        }
      }
      return len;
    };

    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(code)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (start < 0 || start >= len) continue;
      if (inSingleAt[start] || inDoubleAt[start]) continue;

      const depth = flowDepthAt[start];
      const container = flowTopAt[start];

      let scalarStart = 0;
      let scalarEnd = len;

      if (depth > 0) {
        scalarStart = findFlowScalarStart(start, depth, container);
        if (scalarStart !== start) {
          continue; // 先頭でなければプレーンスカラーとして安全
        }
        scalarEnd = findFlowScalarEnd(end, depth, container);
      } else {
        const contentStart = getBlockContentStart();
        const colonIndex = findBlockMappingSeparator(contentStart);
        if (colonIndex !== -1) {
          if (start > colonIndex) {
            // value
            scalarStart = colonIndex + 1;
            while (scalarStart < len && /\s/.test(code[scalarStart])) scalarStart++;

            if (scalarStart !== start) {
              continue;
            }

            scalarEnd = len;
          } else {
            // key（`:` までをスカラーとして扱う）
            scalarStart = contentStart;
            if (scalarStart !== start) {
              continue;
            }
            scalarEnd = colonIndex;
          }
        } else {
          // mapping でない（list item の単一値など）
          scalarStart = contentStart;
          if (scalarStart !== start) {
            continue;
          }
          scalarEnd = len;
        }
      }

      // 既にクォートされている場合は何もしない
      if (scalarStart < len && (code[scalarStart] === '"' || code[scalarStart] === "'")) {
        continue;
      }

      // 末尾の空白はクォート外に出す
      let trimEnd = scalarEnd;
      while (trimEnd > scalarStart && /\s/.test(code[trimEnd - 1])) {
        trimEnd--;
      }

      ranges.push({ start: scalarStart, end: trimEnd });
    }

    if (ranges.length === 0) {
      return code;
    }

    // 重複排除 + 右から適用
    const unique = new Map<string, Range>();
    for (const r of ranges) {
      unique.set(`${r.start}:${r.end}`, r);
    }
    const ordered = Array.from(unique.values()).sort((a, b) => b.start - a.start);

    let updated = code;
    for (const r of ordered) {
      const segment = updated.slice(r.start, r.end);
      const quoted = this.quoteYamlString(segment);
      updated = updated.slice(0, r.start) + quoted + updated.slice(r.end);
    }

    return updated;
  }

  private quoteYamlString(value: string): string {
    // ダブルクォートで全体を囲み、\ と " をエスケープ
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  /**
   * プレースホルダーを生成
   * 形式: [TYPE_NNN] (例: [NAME_001], [PHONE_002])
   */
  private generatePlaceholder(
    type: PIIType,
    mapping: SessionMapping
  ): string {
    // 現在のカウンターを取得（なければ0）
    const currentCounter = mapping.counters.get(type) || 0;
    const newCounter = currentCounter + 1;

    // カウンターを更新
    mapping.counters.set(type, newCounter);

    // 3桁のゼロパディング
    const paddedCounter = newCounter.toString().padStart(3, '0');
    return `[${type}_${paddedCounter}]`;
  }

  /**
   * 単一の値を匿名化（テスト用ユーティリティ）
   */
  anonymizeSingleValue(
    value: string,
    type: PIIType,
    mapping: SessionMapping,
    documentUri: string
  ): { placeholder: string; entry: MappingEntry | null } {
    // 既存のマッピングをチェック
    const existingPlaceholder = mapping.reverseIndex.get(value);
    if (existingPlaceholder) {
      return { placeholder: existingPlaceholder, entry: null };
    }

    // 新しいプレースホルダーを生成
    const placeholder = this.generatePlaceholder(type, mapping);
    const entry: MappingEntry = {
      placeholder,
      original: value,
      type,
      documentUri,
      createdAt: Date.now(),
    };

    return { placeholder, entry };
  }
}
