/**
 * マッピングTreeView
 * サイドバーにPIIマッピング一覧を表示
 */

import * as vscode from 'vscode';
import { MappingService } from '../services/mappingService';
import { PIIType, MappingEntry } from '../types';

/**
 * TreeViewアイテム
 */
class MappingTreeItem extends vscode.TreeItem {
  constructor(
    public readonly itemType: 'category' | 'entry',
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly piiType?: PIIType,
    public readonly entry?: MappingEntry
  ) {
    super(label, collapsibleState);

    if (itemType === 'category') {
      this.contextValue = 'category';
      this.iconPath = new vscode.ThemeIcon('folder');
    } else if (itemType === 'entry' && entry) {
      this.contextValue = 'entry';
      this.tooltip = `元の値: ${entry.original}`;
      this.description = entry.original;
      this.iconPath = new vscode.ThemeIcon('key');
    }
  }
}

/**
 * TreeViewプロバイダー
 */
export class MappingTreeProvider
  implements vscode.TreeDataProvider<MappingTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MappingTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private mappingService: MappingService) {
    // マッピング変更時にTreeViewを更新
    mappingService.onDidChange(() => this.refresh());
  }

  /**
   * TreeViewを更新
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * TreeItemを取得
   */
  getTreeItem(element: MappingTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 子要素を取得
   */
  getChildren(element?: MappingTreeItem): MappingTreeItem[] {
    if (!element) {
      // ルートレベル: カテゴリ（PII種別）を表示
      return this.getCategories();
    }

    if (element.itemType === 'category' && element.piiType) {
      // カテゴリレベル: エントリを表示
      return this.getEntriesByType(element.piiType);
    }

    return [];
  }

  /**
   * カテゴリ一覧を取得
   */
  private getCategories(): MappingTreeItem[] {
    const stats = this.mappingService.getStats();
    const categories: MappingTreeItem[] = [];

    for (const type of Object.values(PIIType)) {
      const count = stats.byType[type];
      if (count > 0) {
        const label = `${this.getTypeLabel(type)} (${count})`;
        categories.push(
          new MappingTreeItem(
            'category',
            label,
            vscode.TreeItemCollapsibleState.Collapsed,
            type
          )
        );
      }
    }

    return categories;
  }

  /**
   * 特定種別のエントリ一覧を取得
   */
  private getEntriesByType(type: PIIType): MappingTreeItem[] {
    const entries = this.mappingService.getEntriesByType(type);
    return entries.map(
      (entry) =>
        new MappingTreeItem(
          'entry',
          entry.placeholder,
          vscode.TreeItemCollapsibleState.None,
          type,
          entry
        )
    );
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
}

/**
 * TreeViewマネージャー
 */
export class MappingTreeViewManager implements vscode.Disposable {
  private treeView: vscode.TreeView<MappingTreeItem>;
  private treeDataProvider: MappingTreeProvider;

  constructor(mappingService: MappingService) {
    this.treeDataProvider = new MappingTreeProvider(mappingService);
    this.treeView = vscode.window.createTreeView('dataairlock.mappingView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
  }

  /**
   * TreeViewを更新
   */
  refresh(): void {
    this.treeDataProvider.refresh();
  }

  /**
   * リソース解放
   */
  dispose(): void {
    this.treeView.dispose();
  }
}
