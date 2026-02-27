APP_DIR := school-app
PLAYWRIGHT_BROWSERS_PATH ?= /opt/playwright-browsers
export PLAYWRIGHT_BROWSERS_PATH

.PHONY: test build test-unit test-e2e run-dev clean install

## Install dependencies (fresh for current OS/arch)
install: clean
	cd $(APP_DIR) && npm ci

## Remove node_modules and build artifacts to avoid cross-arch issues
clean:
	rm -rf $(APP_DIR)/node_modules $(APP_DIR)/.next $(APP_DIR)/out

## Build the Next.js app (installs deps first)
build: install
	cd $(APP_DIR) && npm run build

## Run all tests
test: test-unit test-e2e

## Run unit tests (Vitest)
test-unit:
	cd $(APP_DIR) && npx vitest run

## Run Playwright E2E tests
test-e2e:
	cd $(APP_DIR) && npx playwright test

## Start the dev server
run-dev:
	cd $(APP_DIR) && npm run dev
