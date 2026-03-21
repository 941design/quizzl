APP_DIR := app
PLATFORM_STAMP := $(APP_DIR)/node_modules/.platform_$(shell uname -s)-$(shell uname -m)
PLAYWRIGHT_STAMP := $(APP_DIR)/node_modules/.playwright_$(shell uname -s)-$(shell uname -m)

# Load environment variables from .env if it exists (for FTP credentials)
-include .env
export

.PHONY: help test build test-unit test-e2e test-e2e-groups e2e-up e2e-down playwright run-dev clean install deploy deploy-check deploy-dryrun ssl-cert ensure-deps ensure-playwright

# Default target
.DEFAULT_GOAL := help

# FTP Deployment Configuration
FTP_HOST := $(HOSTEUROPE_FTP_HOST)
FTP_USER := $(HOSTEUROPE_FTP_USER)
FTP_PASS := $(HOSTEUROPE_FTP_PASS)
FTP_PATH := $(or $(HOSTEUROPE_FTP_PATH),/)

# Local paths for deployment
LOCAL_DIST := $(APP_DIR)/out

help: ## Show this help message
	@echo "Quizzl"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

## Always-run check: rebuild node_modules if platform stamp is missing or deps changed
ensure-deps:
	@if [ ! -f $(PLATFORM_STAMP) ] \
	  || [ $(APP_DIR)/package.json -nt $(PLATFORM_STAMP) ] \
	  || [ $(APP_DIR)/package-lock.json -nt $(PLATFORM_STAMP) ]; then \
		echo "[make] Installing deps for $$(uname -s)-$$(uname -m)..."; \
		rm -rf $(APP_DIR)/node_modules $(APP_DIR)/.next $(APP_DIR)/out; \
		cd $(APP_DIR) && npm ci; \
		touch ../$(PLATFORM_STAMP); \
	fi

node_modules: ensure-deps ## Install deps (auto-reinstalls on platform switch)

## Always-run check: install Playwright browsers if stamp is missing
ensure-playwright: ensure-deps
	@if [ ! -f $(PLAYWRIGHT_STAMP) ]; then \
		echo "[make] Installing Playwright browsers for $$(uname -s)-$$(uname -m)..."; \
		cd $(APP_DIR) && npx playwright install chromium; \
		touch ../$(PLAYWRIGHT_STAMP); \
	fi

playwright: ensure-playwright ## Install Playwright browsers (auto-reinstalls on platform/version change)

## Install dependencies (fresh for current OS/arch)
install: clean ## Install dependencies (fresh for current OS/arch)
	cd $(APP_DIR) && npm ci
	@touch $(PLATFORM_STAMP)
	@echo "[make] Installed for $$(uname -s)-$$(uname -m)"

## Remove node_modules and build artifacts to avoid cross-arch issues
clean: ## Remove node_modules and build artifacts
	rm -rf $(APP_DIR)/node_modules $(APP_DIR)/.next $(APP_DIR)/out test-results/

## Build the Next.js app (installs deps first)
build: ensure-deps ## Build for production (static export)
	cd $(APP_DIR) && npm run build
	@echo "Static files available in $(LOCAL_DIST)/"

## Run all tests
test: test-unit test-e2e ## Run all tests

## Run unit tests (Vitest)
test-unit: ensure-deps ## Run unit tests (Vitest)
	cd $(APP_DIR) && npx vitest run

## Run Playwright E2E tests
test-e2e: ensure-playwright ## Run Playwright E2E tests
	cd $(APP_DIR) && node scripts/run-e2e.mjs

## E2E groups infrastructure
e2e-up: ## Start strfry relay for E2E groups tests
	docker compose -f docker-compose.e2e.yml up -d --wait

e2e-down: ## Stop strfry relay
	docker compose -f docker-compose.e2e.yml down -v

## Run Playwright E2E tests for learning groups
test-e2e-groups: ensure-playwright e2e-up ## Run groups E2E tests (strfry + static build)
	cd $(APP_DIR) && E2E_GROUPS=1 node scripts/run-e2e.mjs; \
	status=$$?; \
	cd .. && $(MAKE) e2e-down; \
	exit $$status

## Start the dev server
run-dev: ensure-deps ## Start development server
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

deploy: build deploy-check ## Deploy to production (FTP)
	@echo "Deploying to $(FTP_HOST)$(FTP_PATH)..."
	@lftp -u "$(FTP_USER),$(FTP_PASS)" "$(FTP_HOST)" -e "\
		set ssl:verify-certificate no; \
		mkdir -p $(FTP_PATH); \
		mirror -R --verbose --only-newer --parallel=4 \
			$(LOCAL_DIST)/ $(FTP_PATH)/; \
		bye"
	@echo ""
	@echo "Deployment complete!"

deploy-dryrun: ## Show what would be deployed (no upload)
	@echo "=== Deployment Dry Run ==="
	@echo ""
	@echo "Target: $(FTP_HOST)$(FTP_PATH)"
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
	@echo "  HOSTEUROPE_FTP_PATH=$(FTP_PATH)"

# =============================================================================
# SSL Certificate (Let's Encrypt for HostEurope)
# =============================================================================
# Generates a Let's Encrypt certificate using Certbot DNS manual challenge.
# Output goes to .ssl/ — upload to HostEurope KIS:
#   Webhosting → Sicherheit & SSL → SSL Administrieren → Ersetzen
#
#   ┌──────────────┬─────────────────────────┬───────────────────────────────┐
#   │ KIS Field    │ File                    │ Contents                      │
#   ├──────────────┼─────────────────────────┼───────────────────────────────┤
#   │ Zertifikat   │ .ssl/fullchain.pem      │ Certificate + intermediates   │
#   │ Key          │ .ssl/privkey.pem        │ Private key (keep secret!)    │
#   │ Passwort     │ (leave empty)           │ Not encrypted                 │
#   │ CA           │ (leave empty)           │ Already in fullchain.pem      │
#   └──────────────┴─────────────────────────┴───────────────────────────────┘
#
# Renewal: re-run every ~60-90 days, then re-upload in KIS.
# Requires: certbot (brew install certbot / apt install certbot)

SSL_DOMAIN := quizzl.941design.de
SSL_DIR := .ssl

ssl-cert: ## Generate Let's Encrypt certificate for HostEurope
	@if ! command -v certbot >/dev/null 2>&1; then \
		echo "ERROR: certbot not installed."; \
		echo "  macOS:  brew install certbot"; \
		echo "  Linux:  sudo apt install certbot"; \
		exit 1; \
	fi
	@echo "Generating Let's Encrypt certificate for $(SSL_DOMAIN)..."
	@echo ""
	@echo "This will use a manual DNS challenge — you'll need to create a"
	@echo "TXT record in your DNS settings when prompted."
	@echo ""
	certbot certonly \
		--manual \
		--preferred-challenges dns \
		--key-type rsa \
		--config-dir $(SSL_DIR)/config \
		--work-dir $(SSL_DIR)/work \
		--logs-dir $(SSL_DIR)/logs \
		-d $(SSL_DOMAIN)
	@echo ""
	@echo "=== Certificate generated ==="
	@echo ""
	@echo "Files for HostEurope KIS upload:"
	@echo "  Zertifikat:  $$(find $(SSL_DIR)/config/live/$(SSL_DOMAIN) -name fullchain.pem)"
	@echo "  Key:         $$(find $(SSL_DIR)/config/live/$(SSL_DOMAIN) -name privkey.pem)"
	@echo "  Passwort:    (leave empty)"
	@echo "  CA:          (leave empty)"
	@echo ""
	@echo "Upload at: Webhosting → Sicherheit & SSL → SSL Administrieren → Ersetzen"
	@echo "Renew in ~60-90 days by running: make ssl-cert"
