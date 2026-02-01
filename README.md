# DataAirlock for VSCode

**Japanese PII Pseudonymization Extension for Claude Code Workflows**

DataAirlock helps you safely work with Claude Code on data containing personally identifiable information (PII). It replaces sensitive information with placeholders like `[NAME_001]`, allowing you to share code and documents with AI assistants without exposing real personal data.

---

## Features

### Core Pseudonymization
- **Selection/Document** — Pseudonymize selected text or entire documents
- **File/Folder** — Batch process entire directories with one click
- **Bidirectional** — Full restoration from placeholders to original values

### Detected PII Types
| Type | Examples |
|------|----------|
| Names (Japanese) | 山田太郎, 鈴木花子 |
| Phone Numbers | 03-1234-5678, 090-1234-5678 |
| Email | user@example.com |
| Addresses | 東京都新宿区西新宿1-2-3 |
| My Number | 1234-5678-9012 |
| Date of Birth | 1990/01/01, 平成2年1月1日 |

### Claude Code Integration
- **Safe Backup** — Original data moved to `~/DataAirlock/backups/`
- **`.claudeignore` Generation** — Automatically hide original folders from Claude
- **Output Restoration** — Apply mappings to Claude-generated files

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Pseudonymize Selection | `Ctrl+Alt+P` |
| Restore Selection | `Ctrl+Alt+R` |

---

## Workflow

```
【Pseudonymization】
1. Right-click folder → "DataAirlock: フォルダを仮名化"
2. Select output location
3. Choose "Backup and delete original (recommended)"

Result:
├── project/
│   └── data_pseudonymized/   ← Safe for Claude
└── ~/DataAirlock/backups/    ← Original data secured

【Working with Claude Code】
4. Open project in Claude Code
5. Claude sees only pseudonymized data
6. Claude generates code referencing [NAME_001], etc.

【Restoration】
7. Right-click output folder → "DataAirlock: フォルダを復元"
8. Select "Restore from backup"
9. Original data returns to project

【Output Restoration】
10. Right-click Claude's generated files → "DataAirlock: マッピングを適用"
11. Placeholders replaced with original values
```

---

## Commands

### Context Menu (Right-click)
| Command | Target | Description |
|---------|--------|-------------|
| フォルダを仮名化 | Folder | Pseudonymize all files in folder |
| フォルダを復元 | Folder | Restore from backup or in-place |
| ファイルを仮名化 | File | Pseudonymize single file |
| ファイルを復元 | File | Restore single file |
| マッピングを適用 | File/Folder | Apply mapping to Claude output |

### Command Palette
| Command | Description |
|---------|-------------|
| DataAirlock: 選択範囲を仮名化 | Pseudonymize selected text |
| DataAirlock: 選択範囲を復元 | Restore selected text |
| DataAirlock: ドキュメント全体を仮名化 | Pseudonymize entire document |
| DataAirlock: ドキュメント全体を復元 | Restore entire document |
| DataAirlock: Show Mapping | View current session mappings |
| DataAirlock: Clear Mapping | Clear session mappings |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dataairlock.backupDirectory` | `~/DataAirlock/backups` | Backup location |
| `dataairlock.outputFolderSuffix` | `_pseudonymized` | Suffix for output folders |
| `dataairlock.fileExtensions` | 21 types | File types to process |
| `dataairlock.autoBackup` | `true` | Auto backup originals |
| `dataairlock.highlightColor` | `rgba(255, 200, 0, 0.3)` | PII highlight color |

---

## Security & Privacy

- **Fully local** — No network communication at any point
- **No telemetry** — No usage data collected
- **Local mapping** — Mapping files stored locally, never uploaded

---

## Disclaimer

**This tool assists with pseudonymization but does not guarantee complete PII detection.**

- Pattern-based detection has inherent limitations. Some PII may not be detected.
- **Users are responsible for reviewing output before sharing with external services.**
- This extension is not a substitute for formal data protection review.
- The developers assume no liability for data exposure from undetected PII.
- **Mapping files contain original PII. Treat them as confidential data.**

By using this extension, you acknowledge that pseudonymization reduces — but does not eliminate — the risk of PII exposure.

---

## Requirements

- Visual Studio Code 1.85.0+
- No additional dependencies

## License

[MIT](LICENSE)

## Links

- [GitHub](https://github.com/akira0907/dataairlock-vscode)
- [DataAirlock CLI (PyPI)](https://pypi.org/project/dataairlock/)
- [Issues](https://github.com/akira0907/dataairlock-vscode/issues)
