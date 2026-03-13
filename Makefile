# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 sol pbc

.PHONY: dev clean

dev:
	@echo "serving on http://localhost:8080"
	@python3 -m http.server 8080

clean:
	@echo "nothing to clean — static site"
