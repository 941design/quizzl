# Codebase AI Assistant Stack — Setup Guide

**Stack:** OpenWebUI · mcpo · Serena MCP · PPQ.ai (Mode A) / Claude or OpenAI API (Mode B)  
**Platforms:** Manjaro Linux · macOS (Apple Silicon M4)  
**Goal:** A web UI accessible to non-technical users, backed by semantic codebase understanding via Serena, switchable between a pay-per-use PPQ backend and a direct API/subscription backend.

---

> **Platform difference callouts** are marked 🐧 (Manjaro) and 🍎 (macOS) throughout.  
> Where a step is identical on both platforms, no icon is shown.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Part A — PPQ Account & Wallet Setup](#3-part-a--ppq-account--wallet-setup)
4. [Part B — Direct API Keys (Claude / OpenAI)](#4-part-b--direct-api-keys-claude--openai)
5. [Install System Dependencies](#5-install-system-dependencies)
6. [Install and Configure Serena MCP](#6-install-and-configure-serena-mcp)
7. [Install and Configure mcpo](#7-install-and-configure-mcpo)
8. [Install and Configure OpenWebUI](#8-install-and-configure-openwebui)
9. [Connect Everything in OpenWebUI](#9-connect-everything-in-openwebui)
10. [Create the Codebase Assistant Model](#10-create-the-codebase-assistant-model)
11. [Switching Between Mode A (PPQ) and Mode B (Direct API)](#11-switching-between-mode-a-ppq-and-mode-b-direct-api)
12. [Non-Technical User Access](#12-non-technical-user-access)
13. [Keeping Everything Updated](#13-keeping-everything-updated)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Architecture Overview

```
Browser (non-technical user)
        │
        ▼
  OpenWebUI :3000          ← web chat UI, model switcher, tools
        │
        ├─── API backend ──► PPQ  (https://api.ppq.ai)       [Mode A]
        │                or  Anthropic  (https://api.anthropic.com) [Mode B]
        │                or  OpenAI     (https://api.openai.com)    [Mode B]
        │
        └─── Tools ────────► mcpo :8000
                                │
                                └─► Serena MCP (stdio)
                                          │
                                          └─► Your codebase (local filesystem)
```

**What each component does:**

| Component | Role |
|-----------|------|
| **OpenWebUI** | Web chat interface; manages users, models, tools, RAG |
| **mcpo** | Translates Serena's stdio protocol into HTTP so OpenWebUI can call it |
| **Serena MCP** | Gives the LLM semantic (symbol-level) understanding of the codebase — like an IDE's "Go to definition" |
| **PPQ (Mode A)** | Pay-per-use AI backend; no subscription, crypto-friendly, anonymous |
| **Anthropic / OpenAI API (Mode B)** | Direct API access to Claude or GPT models |

---

## 2. Prerequisites

### Hardware
- Any modern machine with at least **8 GB RAM** (16 GB recommended)
- **~10 GB free disk space** for Docker images
- Your **codebase accessible on the local filesystem** of the machine running the stack

### Accounts needed (choose based on mode)

| Mode | What you need |
|------|---------------|
| **Mode A — PPQ** | PPQ credits (no account required for basic use; optional account for API key + auto top-up) |
| **Mode B — Claude** | Anthropic account at console.anthropic.com with API key |
| **Mode B — OpenAI** | OpenAI account at platform.openai.com with API key |

> **Note on Claude Pro/Max subscriptions:** Claude subscriptions give you access to claude.ai but do **not** reduce your API bill — the API is always billed separately per token. Mode B uses the API directly, which has no monthly fee but charges per token. A Pro subscription and direct API access are two separate billing relationships with Anthropic.

---

## 3. Part A — PPQ Account & Wallet Setup

PPQ requires no email or account for basic use. However, to get an **API key** (needed for OpenWebUI), you need a free account. No credit card is ever required — you can pay entirely with crypto.

### 3.1 Create a PPQ account (optional but recommended)

1. Go to [ppq.ai](https://ppq.ai) and click **Sign Up**
2. You can use a throwaway email or a real one — PPQ does not KYC
3. Once logged in, go to [ppq.ai/api-docs](https://ppq.ai/api-docs) → **Create your first API key**
4. Copy the key (starts with `sk-`) — save it somewhere safe

> **Fully anonymous alternative:** Skip account creation and use PPQ's web UI directly at ppq.ai/chat. However, you will not get an API key and cannot connect it to OpenWebUI. For the OpenWebUI integration, an account with an API key is required.

### 3.2 Top up your PPQ balance

The minimum top-up is $0.10. You have several options:

**Option 1 — Credit card (Stripe)**
- Go to [ppq.ai/credits](https://ppq.ai/credits) and pay by card

**Option 2 — Bitcoin Lightning (fastest, most private)**

You need a Lightning wallet. For ease of use with no prior crypto experience, **Wallet of Satoshi** (mobile, custodial) is the simplest starting point:
1. Download Wallet of Satoshi on iOS or Android
2. It comes pre-funded with a small amount to start; buy more BTC via the app or receive from an exchange
3. On PPQ credits page, select **Bitcoin Lightning** → a QR code / invoice appears
4. Scan and pay from Wallet of Satoshi

> If you want non-custodial (you hold your own keys): use **Phoenix Wallet** (iOS/Android). It has better self-custody but requires a small (~1,000 sat) one-time channel opening fee.

**Option 3 — Monero (most private)**
- Select Monero on the PPQ credits page and pay from any XMR wallet (e.g. Feather Wallet on desktop)

**Option 4 — Nostr Wallet Connect (auto top-up)**

For hands-free automatic reloading when your balance drops below a threshold:
1. Set up **Alby Hub** (self-hosted or cloud) or another NWC-compatible wallet
2. Get your NWC connection string (`nostr+walletconnect://...`)
3. On PPQ go to **Settings → Auto Top-Up** and connect your NWC string, set a threshold (e.g. $5) and refill amount (e.g. $10)

---

## 4. Part B — Direct API Keys (Claude / OpenAI)

### Claude API key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account and add a payment method (credit card)
3. Navigate to **API Keys → Create Key**
4. Copy the key (starts with `sk-ant-`)
5. Recommended starting model: `claude-sonnet-4-6` (best price/performance for agentic use)

### OpenAI API key (Codex / GPT)
1. Go to [platform.openai.com](https://platform.openai.com)
2. Navigate to **API Keys → Create new secret key**
3. Copy the key (starts with `sk-`)

---

## 5. Install System Dependencies

### 5.1 Docker

Docker runs OpenWebUI and mcpo as containers — this is the most reliable, cross-platform setup.

**🐧 Manjaro:**
```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

**🍎 macOS:**
1. Download **Docker Desktop** from [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop)
2. Choose the **Apple Silicon** version
3. Install and launch Docker Desktop
4. Wait for the whale icon in the menu bar to stop animating (Docker is ready)

Verify Docker is working on both platforms:
```bash
docker run hello-world
```

### 5.2 uv (Python package manager — needed for Serena and mcpo)

`uv` is a fast Python tool manager that handles virtual environments and package installation. It is the recommended way to run both Serena and mcpo without polluting your system Python.

**Both platforms:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then restart your terminal or run:
```bash
source $HOME/.local/bin/env
```

Verify:
```bash
uv --version
```

### 5.3 Git

**🐧 Manjaro:**
```bash
sudo pacman -S git
```

**🍎 macOS:**
Git comes pre-installed. If prompted to install Xcode Command Line Tools, accept.

---

## 6. Install and Configure Serena MCP

Serena runs locally, directly on your filesystem. It does **not** run in Docker — it needs direct access to your codebase and uses Language Server Protocol (LSP) tools that work best as native processes.

### 6.1 Install Serena

```bash
# Clone Serena
git clone https://github.com/oraios/serena.git ~/serena
cd ~/serena

# Install dependencies via uv
uv sync
```

### 6.2 Pre-index your codebase

Pre-indexing dramatically speeds up Serena's first queries on large codebases:

```bash
uvx --from git+https://github.com/oraios/serena index-project /path/to/your/codebase
```

Replace `/path/to/your/codebase` with the actual absolute path to your project root.

This creates a `.serena/` directory inside your project with the index. You can re-run this command whenever the codebase changes significantly.

### 6.3 Test Serena manually (optional)

```bash
cd ~/serena
uv run serena-mcp-server --context agent --project /path/to/your/codebase
```

You should see startup logs. Press Ctrl+C to stop. If it errors, check that your codebase path is correct.

### 6.4 Configure Serena for read-only mode (recommended for non-technical users)

If your non-technical users should be able to ask questions about the codebase but **not trigger code changes**, enable read-only mode. Create or edit `.serena/project.yml` inside your codebase:

```yaml
# .serena/project.yml
read_only: true
```

With this set, Serena will refuse all editing tools while still providing full analysis and navigation capabilities.

---

## 7. Install and Configure mcpo

mcpo wraps Serena's stdio interface in HTTP so OpenWebUI can reach it.

### 7.1 Create a working directory

```bash
mkdir -p ~/ai-stack/mcpo
cd ~/ai-stack/mcpo
```

### 7.2 Create the mcpo config file

This file tells mcpo which MCP servers to proxy. It uses the same format as Claude Desktop's config.

Create `~/ai-stack/mcpo/config.json`:

```json
{
  "mcpServers": {
    "serena": {
      "command": "uv",
      "args": [
        "run",
        "--directory", "/Users/yourname/serena",
        "serena-mcp-server",
        "--context", "agent",
        "--project", "/path/to/your/codebase"
      ]
    }
  }
}
```

**Important substitutions:**
- Replace `/Users/yourname/serena` with the actual path where you cloned Serena
  - 🐧 Manjaro: likely `/home/yourname/serena`
  - 🍎 macOS: likely `/Users/yourname/serena`
- Replace `/path/to/your/codebase` with your actual codebase path

> **Multiple codebases:** You can add multiple Serena entries with different project paths. Each gets its own HTTP endpoint in mcpo, and you can add all of them as tools in OpenWebUI.

```json
{
  "mcpServers": {
    "serena-project-alpha": {
      "command": "uv",
      "args": ["run", "--directory", "/home/you/serena", "serena-mcp-server",
               "--context", "agent", "--project", "/home/you/projects/alpha"]
    },
    "serena-project-beta": {
      "command": "uv",
      "args": ["run", "--directory", "/home/you/serena", "serena-mcp-server",
               "--context", "agent", "--project", "/home/you/projects/beta"]
    }
  }
}
```

### 7.3 Run mcpo

mcpo will be run directly with `uvx` (no Docker needed for mcpo itself):

```bash
uvx mcpo --port 8000 --api-key "your-mcpo-secret" --config ~/ai-stack/mcpo/config.json
```

Replace `your-mcpo-secret` with any string you choose — this is a local secret used by OpenWebUI to authenticate to mcpo. Write it down; you'll need it in Step 9.

**To run mcpo in the background and keep it running after logout:**

**🐧 Manjaro — create a systemd user service:**

```bash
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/mcpo.service`:

```ini
[Unit]
Description=mcpo MCP-to-OpenAPI proxy
After=network.target

[Service]
ExecStart=/home/yourname/.local/bin/uvx mcpo --port 8000 --api-key "your-mcpo-secret" --config /home/yourname/ai-stack/mcpo/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:
```bash
systemctl --user enable --now mcpo
systemctl --user status mcpo
```

**🍎 macOS — create a launchd plist:**

Create `~/Library/LaunchAgents/ai.mcpo.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.mcpo</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/yourname/.local/bin/uvx</string>
    <string>mcpo</string>
    <string>--port</string>
    <string>8000</string>
    <string>--api-key</string>
    <string>your-mcpo-secret</string>
    <string>--config</string>
    <string>/Users/yourname/ai-stack/mcpo/config.json</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/mcpo.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mcpo.err</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/ai.mcpo.plist
```

**Verify mcpo is running on both platforms:**
```bash
curl http://localhost:8000/serena/openapi.json
```
You should get a JSON response describing Serena's available tools.

---

## 8. Install and Configure OpenWebUI

OpenWebUI runs in Docker. This is identical on both platforms.

### 8.1 Create the Docker Compose file

Create `~/ai-stack/docker-compose.yml`:

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "3000:8080"
    volumes:
      - open-webui-data:/app/backend/data
    environment:
      # Disable Ollama (we use external APIs only)
      - OLLAMA_BASE_URL=
      # Secret key — change this to a random string
      - WEBUI_SECRET_KEY=change-this-to-a-random-string
      # Allow new user signups (set to false after initial setup)
      - ENABLE_SIGNUP=true

volumes:
  open-webui-data:
```

> **On macOS with Docker Desktop:** The container can reach your host machine's services (like mcpo on port 8000) via the special hostname `host.docker.internal`. This is automatically available in Docker Desktop. **On Manjaro with Docker Engine**, you need to add `--add-host=host.docker.internal:host-gateway` — this is handled by adding it to the compose file:

**🐧 Manjaro only** — add this to the `open-webui` service in docker-compose.yml:
```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 8.2 Start OpenWebUI

```bash
cd ~/ai-stack
docker compose up -d
```

Wait about 30 seconds for the first startup, then open your browser:

```
http://localhost:3000
```

### 8.3 Create your admin account

On first visit you'll be prompted to create an account. The first account is automatically the admin. Use any email and password — this is local only, no data leaves your machine.

---

## 9. Connect Everything in OpenWebUI

### 9.1 Add PPQ as an API connection (Mode A)

1. Go to ⚙️ **Admin Settings → Connections**
2. Under **OpenAI API**, click **➕ Add New Connection**
3. Fill in:
   - **URL:** `https://api.ppq.ai/v1`
   - **API Key:** your PPQ key (starts with `sk-`)
   - **Name:** `PPQ`
4. Click **Save** — OpenWebUI will auto-detect all available PPQ models

### 9.2 Add Claude API as a connection (Mode B — Claude)

1. Go to ⚙️ **Admin Settings → Connections**
2. Click **➕ Add New Connection**
3. Fill in:
   - **URL:** `https://api.anthropic.com/v1`  
     *(OpenWebUI has a built-in Anthropic compatibility layer — it detects this URL automatically)*
   - **API Key:** your Anthropic key (starts with `sk-ant-`)
   - **Name:** `Anthropic`
4. Click **Save**

### 9.3 Add OpenAI as a connection (Mode B — Codex/GPT)

1. Go to ⚙️ **Admin Settings → Connections**
2. Click **➕ Add New Connection**
3. Fill in:
   - **URL:** `https://api.openai.com/v1`
   - **API Key:** your OpenAI key (starts with `sk-`)
   - **Name:** `OpenAI`
4. Click **Save**

> You can have all three connections configured simultaneously. Each has a toggle switch to enable or disable it without deleting the configuration. This is how you switch modes — see Section 11.

### 9.4 Add Serena as an external tool (via mcpo)

1. Go to ⚙️ **Admin Settings → External Tools**
2. Click **➕ Add Server**
3. Fill in:
   - **Type:** `OpenAPI`
   - **URL:** `http://host.docker.internal:8000/serena`
   - **Auth Type:** `Bearer`
   - **Token:** your mcpo secret (the string you set with `--api-key` in Step 7.3)
4. Click **Save**

OpenWebUI will fetch the OpenAPI spec from mcpo and register all of Serena's tools. You should see tools like `find_symbol`, `get_symbols_overview`, `search_for_pattern`, and others appear in the tool list.

---

## 10. Create the Codebase Assistant Model

This is the key step that makes the system easy for non-technical users — you pre-configure a "model" in OpenWebUI that has Serena always enabled, a helpful system prompt, and the right settings. Users just select this model and start asking questions.

### 10.1 Create the model

1. Go to ⚙️ **Admin Settings → Workspace → Models**
2. Click **➕ Create Model**
3. Fill in:
   - **Model ID:** `codebase-assistant`
   - **Name:** `Codebase Assistant`
   - **Base Model:** select `claude-sonnet-4-6` (or your preferred model from PPQ or Anthropic)
   - **Description:** `Ask questions about our codebase in plain English`

4. Under **System Prompt**, paste:

```
You are a codebase assistant. You have access to the Serena tools which give you 
IDE-like semantic understanding of the project codebase.

When a user asks a question about the code:
1. Use get_symbols_overview or find_symbol to locate relevant code
2. Use get_symbol_body to read implementation details
3. Use find_referencing_symbols to understand how things are connected
4. Explain your findings in plain, non-technical language

You should:
- Never require the user to know file paths or function names
- Always explain what code does in terms of what it achieves, not how
- Summarize changes or problems in business terms where possible
- If asked to make changes, describe what would change and ask for confirmation first

The project is located at /path/to/your/codebase.
To start, activate the project by calling the activate_project tool with the project path.
```

5. Under **Tools**, check **Serena** (or the name you gave the tool in step 9.4)
6. Set **Tool Calling Mode** to **Native** (Agentic mode — more reliable)
7. Click **Save**

### 10.2 Set tool auto-activation

By default users have to manually toggle tools on in the chat menu. To make Serena always-on for this model:

In the model settings, under **Tools**, check **Auto-activate** next to Serena.

---

## 11. Switching Between Mode A (PPQ) and Mode B (Direct API)

Because OpenWebUI supports multiple simultaneous API connections with per-connection toggles, switching is a one-click admin operation.

### Switching to Mode A (PPQ only)

1. Go to ⚙️ **Admin Settings → Connections**
2. **Disable** the Anthropic and/or OpenAI connections using their toggle switches
3. **Enable** the PPQ connection
4. Edit the Codebase Assistant model (Workspace → Models) and change its **Base Model** to a PPQ model (e.g. `claude-sonnet-4-5` or `gpt-5`)

### Switching to Mode B (Direct API)

1. Go to ⚙️ **Admin Settings → Connections**
2. **Disable** the PPQ connection
3. **Enable** the Anthropic or OpenAI connection
4. Edit the Codebase Assistant model and change its **Base Model** to `claude-sonnet-4-6` or equivalent

> **Tip:** You can keep all connections enabled simultaneously and simply change which base model the Codebase Assistant uses. This lets you compare outputs from different backends without any disruption to users.

---

## 12. Non-Technical User Access

### Adding users

1. Go to ⚙️ **Admin Settings → Users → Invite Users** (or share the signup URL)
2. New users sign up at `http://your-machine-ip:3000`
3. After signup, approve their account in Admin → Users and assign them the **User** role

### What users see

When a user logs in, they see the standard OpenWebUI chat interface. They should:
1. Select **Codebase Assistant** from the model dropdown at the top of the chat
2. Ask questions in plain English, e.g.:
   - "What does the payment processing module do?"
   - "Where is the user authentication handled?"
   - "Which parts of the code would be affected if we changed the database schema?"
   - "Is there anything that calls the `sendEmail` function?"

The model will automatically invoke Serena's tools in the background, navigate the codebase, and return a plain-English answer.

### Making it accessible on your local network

By default OpenWebUI is only accessible on `localhost`. To make it available to other machines on your network (e.g. a colleague's laptop):

**🐧 Manjaro:** OpenWebUI is already listening on `0.0.0.0:3000`. Other machines can reach it at `http://your-machine-ip:3000`. Find your IP with `ip addr`.

**🍎 macOS:** Same — find your IP in System Settings → Network → your connection → IP Address.

For a more permanent internal URL, consider setting up a local DNS entry or using a reverse proxy like Caddy or nginx.

---

## 13. Keeping Everything Updated

### Update OpenWebUI

```bash
cd ~/ai-stack
docker compose pull
docker compose up -d
```

Your chat history, users, and settings are stored in the `open-webui-data` Docker volume and are not affected by updates.

### Update Serena

```bash
cd ~/serena
git pull
uv sync
```

Then restart mcpo:

**🐧 Manjaro:**
```bash
systemctl --user restart mcpo
```

**🍎 macOS:**
```bash
launchctl unload ~/Library/LaunchAgents/ai.mcpo.plist
launchctl load ~/Library/LaunchAgents/ai.mcpo.plist
```

### Re-index the codebase

After significant code changes, re-run the indexer:

```bash
uvx --from git+https://github.com/oraios/serena index-project /path/to/your/codebase
```

Then restart mcpo as above.

---

## 14. Troubleshooting

### OpenWebUI can't reach mcpo

**Symptom:** Tool calls fail with a connection error.

**Check:**
```bash
# Verify mcpo is running
curl http://localhost:8000/serena/openapi.json

# From inside Docker, verify host connectivity
docker exec open-webui curl http://host.docker.internal:8000/serena/openapi.json
```

If the second command fails on Manjaro, ensure `extra_hosts: - "host.docker.internal:host-gateway"` is in your docker-compose.yml.

### Serena fails to start in mcpo

**Symptom:** `curl http://localhost:8000/serena/openapi.json` returns an error or empty response.

**Check mcpo logs:**

**🐧 Manjaro:**
```bash
journalctl --user -u mcpo -f
```

**🍎 macOS:**
```bash
tail -f /tmp/mcpo.err
```

Common causes:
- Wrong path to Serena in `config.json` — double-check `--directory` and `--project` paths
- Serena dependencies not installed — re-run `uv sync` inside the serena directory
- The codebase path doesn't exist or isn't readable

### No models appear after adding PPQ connection

PPQ's model list is large. If models don't auto-detect, go to the connection settings and manually add model IDs to the **Model IDs allowlist**, e.g.:
```
claude-sonnet-4-5
claude-opus-4-5
gpt-5
gemini-2.5-flash
```

### Serena activates but returns no results

The model needs to activate the project before querying it. If auto-activation isn't happening, add this to the beginning of the Codebase Assistant system prompt:

```
At the start of every conversation, call activate_project with the path /path/to/your/codebase before answering any questions.
```

### PPQ balance depleted mid-conversation

You'll receive an API error. Top up at ppq.ai/credits. If you've set up NWC auto top-up, check your wallet has sufficient balance.

---

## Quick Reference

| Service | URL | Config location |
|---------|-----|-----------------|
| OpenWebUI | http://localhost:3000 | Admin Settings in UI |
| mcpo (Serena tools) | http://localhost:8000 | ~/ai-stack/mcpo/config.json |
| Serena index | — | /path/to/codebase/.serena/ |
| PPQ API | https://api.ppq.ai/v1 | OpenWebUI connections |
| Anthropic API | https://api.anthropic.com/v1 | OpenWebUI connections |
| OpenAI API | https://api.openai.com/v1 | OpenWebUI connections |

| Port | Used by |
|------|---------|
| 3000 | OpenWebUI (browser) |
| 8000 | mcpo (internal, OpenWebUI → mcpo) |
| 8080 | OpenWebUI internal (mapped to 3000) |
