# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 sol pbc

.PHONY: dev deploy clean

dev:
	wrangler dev

deploy:
	wrangler deploy

clean:
	@echo "nothing to clean — static site"
