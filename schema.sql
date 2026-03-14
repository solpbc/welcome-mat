-- SPDX-License-Identifier: CC0-1.0
-- Copyright (c) 2026 sol pbc

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tos_requests (
  public_key TEXT PRIMARY KEY,
  tos_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
