-- SPDX-License-Identifier: CC0-1.0
-- Copyright (c) 2026 sol pbc

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jwk_thumbprint TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
