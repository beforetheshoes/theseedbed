.PHONY: dev dev-api dev-api-bitwarden dev-web dev-up dev-codex codex install install-api install-web \
	supabase-start supabase-env supabase-health ensure-web-env ensure-dev-db \
	lint lint-api lint-web format format-api format-web \
	format-check format-check-api format-check-web \
	typecheck typecheck-api test test-api test-web test-unit test-e2e \
	build build-api build-web quality

API_VENV_PY := $(CURDIR)/apps/api/.venv/bin/python
API_RUN := $(if $(wildcard $(API_VENV_PY)),$(API_VENV_PY) -m,uv run)
API_BUILD := $(if $(wildcard $(API_VENV_PY)),$(API_VENV_PY) -m build,uv build)

# Run both API and web in development mode
dev: ensure-web-env ensure-dev-db
	@echo "Starting API and web servers..."
	@make -j2 dev-api dev-web

# Install, configure env, link .env to web, then start dev servers
dev-up:
	@make install
	@make supabase-env
	@make dev

# Kill any listener on 3000/3001/8000, clear web build artifacts, then start dev servers
dev-codex:
	@for port in 3000 3001 8000; do \
		echo "Checking port $$port..."; \
		pids="$$(lsof -nP -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true)"; \
		if [ -n "$$pids" ]; then \
			echo "Stopping process(es) on port $$port: $$pids"; \
			kill -TERM $$pids || true; \
			for i in 1 2 3 4 5 6 7 8 9 10; do \
				sleep 0.5; \
				remaining="$$(lsof -nP -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true)"; \
				if [ -z "$$remaining" ]; then \
					echo "Port $$port released."; \
					break; \
				fi; \
				if [ "$$i" -eq 10 ]; then \
					echo "Force killing remaining process(es) on $$port: $$remaining"; \
					kill -KILL $$remaining || true; \
				fi; \
			done; \
		else \
			echo "Port $$port is already free."; \
		fi; \
	done
	@echo "Cleaning apps/web/.next..."
	@rm -rf "$(CURDIR)/apps/web/.next"
	@echo "Starting dev servers..."
	@$(MAKE) dev

# Short alias for dev-codex
codex: dev-codex

# Run API server
dev-api:
	cd apps/api && $(API_RUN) uvicorn main:app --reload --port 8000

# Run API server with GOOGLE_BOOKS_API_KEY loaded from Bitwarden Secrets Manager
dev-api-bitwarden:
	cd apps/api && $(if $(wildcard $(API_VENV_PY)),$(API_VENV_PY),uv run python) scripts/dev_api_with_bitwarden.py

# Run web server
dev-web:
	cd apps/web && pnpm dev

# Link repo root .env for Next.js runtime config when available
ensure-web-env:
	@if [ -f ".env" ]; then \
		ln -sfn "$(CURDIR)/.env" apps/web/.env.local; \
		echo "Linked .env to apps/web/.env.local"; \
	elif [ ! -f ".env" ]; then \
		echo "No repo root .env found; run 'make supabase-env' to generate local Supabase env."; \
	fi

# Ensure local Supabase is running and all API DB migrations are applied.
ensure-dev-db: supabase-env
	@echo "Applying API migrations..."
	cd apps/api && $(API_RUN) alembic upgrade head

# Supabase local dev
supabase-start:
	supabase start

supabase-env: supabase-start
	@tmp_env="$$(mktemp)"; \
	supabase status -o env | while IFS= read -r line; do \
		case "$$line" in \
			API_URL=*) \
				value="$${line#API_URL=}"; \
				echo "SUPABASE_URL=$$value"; \
				echo "NEXT_PUBLIC_SUPABASE_URL=$$value"; \
				;; \
			ANON_KEY=*) \
				value="$${line#ANON_KEY=}"; \
				echo "SUPABASE_ANON_KEY=$$value"; \
				echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$$value"; \
				;; \
			DB_URL=*) \
				value="$${line#DB_URL=}"; \
				echo "SUPABASE_DB_URL=$$value"; \
				;; \
			POSTGRES_URL=*) \
				value="$${line#POSTGRES_URL=}"; \
				echo "SUPABASE_DB_URL=$$value"; \
				;; \
			SERVICE_ROLE_KEY=*) \
				value="$${line#SERVICE_ROLE_KEY=}"; \
				echo "SUPABASE_SERVICE_ROLE_KEY=$$value"; \
				;; \
			JWT_SECRET=*) \
				value="$${line#JWT_SECRET=}"; \
				echo "SUPABASE_JWT_SECRET=$$value"; \
				;; \
		esac; \
	done > "$$tmp_env"; \
	for key in GOOGLE_BOOKS_API_KEY BOOK_PROVIDER_GOOGLE_ENABLED; do \
		if [ -f ".env" ]; then \
			existing_line="$$(grep -E "^$$key=" .env | tail -n 1)"; \
			if [ -n "$$existing_line" ] && ! grep -q -E "^$$key=" "$$tmp_env"; then \
				printf '%s\n' "$$existing_line" >> "$$tmp_env"; \
			fi; \
		fi; \
	done; \
	mv "$$tmp_env" .env
	@echo "Wrote .env from local Supabase status."

supabase-health:
	@scripts/supabase-health.sh

# Install all dependencies
install: install-api install-web

# Install API dependencies
install-api:
	cd apps/api && uv sync --extra dev

# Install web dependencies
install-web:
	cd apps/web && pnpm install

# Run all quality checks, tests, and builds
quality: format-check lint typecheck test build

# Linting
lint: lint-api lint-web

lint-api:
	cd apps/api && $(API_RUN) ruff check .

lint-web:
	cd apps/web && pnpm lint

# Formatting
format: format-api format-web

format-api:
	cd apps/api && $(API_RUN) black .

format-web:
	cd apps/web && pnpm format

format-check: format-check-api format-check-web

format-check-api:
	cd apps/api && $(API_RUN) black --check .

format-check-web:
	cd apps/web && pnpm format:check

# Type checking
typecheck: typecheck-api

typecheck-api:
	cd apps/api && $(API_RUN) mypy .

# Tests
test: test-api test-web

test-api:
	cd apps/api && $(API_RUN) pytest

test-web: test-unit test-e2e

test-unit:
	cd apps/web && pnpm test:unit

test-e2e:
	cd apps/web && pnpm test:e2e

# Builds
build: build-api build-web

build-api:
	cd apps/api && $(API_BUILD)

build-web:
	cd apps/web && pnpm build
