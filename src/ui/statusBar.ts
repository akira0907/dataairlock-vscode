/**
 * ステータスバー管理
 * PIIマッピング数を表示
 */

import * as vscode from 'vscode';
import { MappingService } from '../services/mappingService';
import { PIIType } from '../types';

/**
 * ステータスバー管理クラス
 */
export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;

  constructor(private mappingService: MappingService) {
    // 右側に配置、優先度100
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    // クリックでマッピング表示コマンドを実行
    this.statusBarItem.command = 'dataairlock.showMapping';
    this.statusBarItem.name = 'DataAirlock PII Count';

    // 初期表示
    this.update();

    // マッピング変更時に更新
    mappingService.onDidChange(() => this.update());
  }

  /**
   * ステータスバーを更新
   */
  update(): void {
    const stats = this.mappingService.getStats();

    if (stats.total === 0) {
      this.statusBarItem.text = '$(shield) PII: 0';
      this.statusBarItem.tooltip = 'DataAirlock - PIIマッピングなし';
    } else {
      this.statusBarItem.text = `$(shield) PII: ${stats.total}`;
      this.statusBarItem.tooltip = this.buildTooltip(stats);
    }

    this.statusBarItem.show();
  }

  /**
   * ツールチップを生成
   */
  private buildTooltip(stats: {
    total: number;
    byType: Record<PIIType, number>;
  }): string {
    const lines: string[] = [
      'DataAirlock - クリックでマッピング表示',
      '',
      `合計: ${stats.total}件`,
    ];

    // 種別ごとのカウントを追加
    for (const type of Object.values(PIIType)) {
      const count = stats.byType[type];
      if (count > 0) {
        const label = this.getTypeLabel(type);
        lines.push(`  ${label}: ${count}件`);
      }
    }

    return lines.join('\n');
  }

  /**
   * PII種別の日本語ラベルを取得
   */
  private getTypeLabel(type: PIIType): string {
    const labels: Record<PIIType, string> = {
      [PIIType.NAME]: '氏名',
      [PIIType.PHONE]: '電話番号',
      [PIIType.EMAIL]: 'メール',
      [PIIType.ADDRESS]: '住所',
      [PIIType.MYNUMBER]: 'マイナンバー',
      [PIIType.DOB]: '生年月日',
    };
    return labels[type] || type;
  }

  /**
   * ステータスバーを表示
   */
  show(): void {
    this.statusBarItem.show();
  }

  /**
   * ステータスバーを非表示
   */
  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * リソース解放
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
