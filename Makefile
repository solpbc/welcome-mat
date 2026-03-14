# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 sol pbc

.PHONY: dev deploy db-schema clean

dev:
	wrangler dev

deploy:
	wrangler deploy

db-schema:
	wrangler d1 execute welcome-mat-db --file=schema.sql --remote

clean:
	@echo "nothing to clean"
