APP_DIR := app
# Load environment variables from .env if it exists (for FTP credentials)
-include .env
export

.PHONY: help test build test-unit test-e2e run-dev clean install deploy deploy-check deploy-dryrun

# Default target
.DEFAULT_GOAL := help

# FTP Deployment Configuration
FTP_HOST := $(HOSTEUROPE_FTP_HOST)
FTP_USER := $(HOSTEUROPE_FTP_USER)
FTP_PASS := $(HOSTEUROPE_FTP_PASS)

# Remote paths (hosteurope)
REMOTE_ROOT := /group-learn

# Local paths for deployment
LOCAL_DIST := $(APP_DIR)/out

help: ## Show this help message
	@echo "Group Learning Prototype"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

## Install dependencies (fresh for current OS/arch)
install: clean ## Install dependencies (fresh for current OS/arch)
	cd $(APP_DIR) && npm ci

## Remove node_modules and build artifacts to avoid cross-arch issues
clean: ## Remove node_modules and build artifacts
	rm -rf $(APP_DIR)/node_modules $(APP_DIR)/.next $(APP_DIR)/out

## Build the Next.js app (installs deps first)
build: install ## Build for production (static export)
	cd $(APP_DIR) && npm run build
	@echo "Static files available in $(LOCAL_DIST)/"

## Run all tests
test: test-unit test-e2e ## Run all tests

## Run unit tests (Vitest)
test-unit: ## Run unit tests (Vitest)
	cd $(APP_DIR) && npx vitest run

## Run Playwright E2E tests
test-e2e: ## Run Playwright E2E tests
	cd $(APP_DIR) && npx playwright install chromium && npx playwright test

## Start the dev server
run-dev: ## Start development server
	cd $(APP_DIR) && npm run dev

# =============================================================================
# Production Deployment (FTP to hosteurope)
# =============================================================================

deploy-check: ## Verify deployment prerequisites
	@echo "Checking deployment prerequisites..."
	@if [ -z "$(FTP_HOST)" ]; then echo "ERROR: HOSTEUROPE_FTP_HOST not set"; exit 1; fi
	@if [ -z "$(FTP_USER)" ]; then echo "ERROR: HOSTEUROPE_FTP_USER not set"; exit 1; fi
	@if [ -z "$(FTP_PASS)" ]; then echo "ERROR: HOSTEUROPE_FTP_PASS not set"; exit 1; fi
	@if [ ! -d $(LOCAL_DIST) ]; then echo "ERROR: Build output not found at $(LOCAL_DIST)/"; echo "Run 'make build' first"; exit 1; fi
	@if [ ! -f $(LOCAL_DIST)/index.html ]; then echo "ERROR: index.html not found in $(LOCAL_DIST)/"; exit 1; fi
	@if ! command -v lftp >/dev/null 2>&1; then echo "ERROR: lftp not installed. Run: brew install lftp"; exit 1; fi
	@echo "All prerequisites satisfied."

deploy: deploy-check ## Deploy to production (FTP)
	@echo "Deploying to $(FTP_HOST)$(REMOTE_ROOT)..."
	@lftp -u "$(FTP_USER),$(FTP_PASS)" "$(FTP_HOST)" -e "\
		set ssl:verify-certificate no; \
		mkdir -p $(REMOTE_ROOT); \
		mirror -R --verbose --only-newer --parallel=4 \
			$(LOCAL_DIST)/ $(REMOTE_ROOT)/; \
		bye"
	@echo ""
	@echo "Deployment complete!"

deploy-dryrun: ## Show what would be deployed (no upload)
	@echo "=== Deployment Dry Run ==="
	@echo ""
	@echo "Target: $(FTP_HOST)$(REMOTE_ROOT)"
	@echo ""
	@echo "Local build output: $(LOCAL_DIST)/"
	@if [ -d $(LOCAL_DIST) ]; then \
		echo ""; \
		ls -la $(LOCAL_DIST)/ 2>/dev/null; \
		echo ""; \
		echo "Total size:"; \
		du -sh $(LOCAL_DIST)/; \
	else \
		echo "  [NOT BUILT - run 'make build']"; \
	fi
	@echo ""
	@echo "Environment variables (from .env):"
	@echo "  HOSTEUROPE_FTP_HOST=$(FTP_HOST)"
	@echo "  HOSTEUROPE_FTP_USER=$(FTP_USER)"
	@if [ -n "$(FTP_PASS)" ]; then echo "  HOSTEUROPE_FTP_PASS=****"; else echo "  HOSTEUROPE_FTP_PASS=[NOT SET]"; fi
