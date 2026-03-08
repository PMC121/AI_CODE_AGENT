# Autonomous AI Agent

A Node.js autonomous AI coding system that reads a Jira ticket, creates a feature branch in Bitbucket, modifies the codebase using AI reasoning, tests the application locally, and raises a pull request automatically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Autonomous AI Agent                       │
│                                                             │
│  1. Fetch Jira Ticket          → JiraClient                 │
│  2. Create Feature Branch      → BitbucketClient            │
│  3. Clone Repository           → GitManager                 │
│  4. Checkout Branch            → GitManager                 │
│  5. AI Reads Repo + Reasons    → AIEngine (OpenAI)          │
│  6. AI Modifies/Creates Files  → AIEngine + FileManager     │
│  7. Run Application Locally    → AppRunner                  │
│  8. Fix Errors Automatically   → AIEngine + loop            │
│  9. Commit Changes             → GitManager                 │
│ 10. Push Branch                → GitManager                 │
│ 11. Create Pull Request        → BitbucketClient            │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then fill in your credentials in `.env`:

| Variable | Description |
|---|---|
| `JIRA_BASE_URL` | e.g. `https://myorg.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | Jira API token (from id.atlassian.com) |
| `BITBUCKET_WORKSPACE` | Bitbucket workspace slug |
| `BITBUCKET_REPO_SLUG` | Repository slug |
| `BITBUCKET_USERNAME` | Bitbucket username |
| `BITBUCKET_APP_PASSWORD` | Bitbucket App Password (not account password) |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `OPENAI_MODEL` | Model to use (default: `gpt-4o`) |
| `APP_START_COMMAND` | Command to test the app (e.g. `npm test`) |

### 3. Run the agent

```bash
node src/index.js <JIRA_TICKET_ID>
```

**Example:**
```bash
node src/index.js PROJ-123
```

## Project Structure

```
src/
├── index.js          # Entry point & orchestrator
├── config.js         # Configuration loader
├── clients/
│   ├── jira.js       # Jira REST API client
│   └── bitbucket.js  # Bitbucket REST API client
├── core/
│   ├── git.js        # Git operations (clone, branch, commit, push)
│   ├── ai.js         # OpenAI reasoning & code generation engine
│   ├── fileManager.js# File read/write with diff tracking
│   └── appRunner.js  # Local application runner & error capture
└── utils/
    ├── logger.js     # Colored terminal logger
    └── retry.js      # Retry helper with backoff
```

## How It Works

1. **Jira Fetch** – Reads ticket summary, description, and acceptance criteria.
2. **Branch Creation** – Creates `feature/<ticket-id>-<slug>` in Bitbucket.
3. **Clone + Checkout** – Clones the repo into `./workspaces/<ticket-id>/` and checks out the branch.
4. **AI Reasoning** – GPT-4o reads the repo structure and key files, then produces a step-by-step implementation plan.
5. **Code Generation** – The AI outputs file changes (create/modify) which are applied to disk.
6. **Testing** – Runs `APP_START_COMMAND`. If it fails, the error output is fed back to the AI.
7. **Auto-Fix Loop** – Up to `MAX_FIX_ATTEMPTS` retry cycles of (run → capture error → AI fix → re-run).
8. **Commit & Push** – Commits all changes with a meaningful message and pushes.
9. **Pull Request** – Opens a PR targeting `BITBUCKET_BASE_BRANCH` with the Jira ticket as title.
