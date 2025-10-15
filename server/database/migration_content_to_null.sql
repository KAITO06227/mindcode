-- Migration: project_files.content カラムを NULL 許容に変更
-- 目的: ファイルコンテンツをDBに保存せず、物理ファイルから読み込むようにする
-- 実行日: 2025-10-14
-- 影響: project_files テーブルの content カラムを NULL 許容に変更し、既存データを NULL に更新

-- ==================================================
-- ステップ 1: 既存の content データを NULL に更新
-- ==================================================
-- 注意: カラム定義変更前に、まず既存データをNULLに更新する必要があります
-- これにより大きなデータによるエラーを回避できます

-- 全てのファイルの content を NULL に更新
UPDATE project_files
SET content = NULL
WHERE file_type != 'folder' AND content IS NOT NULL;

-- フォルダの content も NULL に統一
UPDATE project_files
SET content = NULL
WHERE file_type = 'folder';

-- ==================================================
-- ステップ 2: content カラムの型を変更（LONGTEXT → TEXT NULL）
-- ==================================================
-- 既存データが全てNULLになったので、型変更が安全に実行できます

ALTER TABLE project_files
MODIFY COLUMN content TEXT NULL
COMMENT 'File content (deprecated, use physical file instead)';

-- ==================================================
-- ステップ 3: ディスク使用量の確認（オプション）
-- ==================================================
-- content カラムの削除によるディスク節約を確認

SELECT
  COUNT(*) AS total_files,
  SUM(file_size) AS total_size_bytes,
  ROUND(SUM(file_size) / 1024 / 1024, 2) AS total_size_mb
FROM project_files
WHERE file_type != 'folder';

-- ==================================================
-- ロールバック用SQL（必要な場合）
-- ==================================================
-- content カラムを NOT NULL に戻す場合（既存のNULLは空文字列に置き換える必要がある）
-- ALTER TABLE project_files
-- MODIFY COLUMN content TEXT NOT NULL DEFAULT '';
