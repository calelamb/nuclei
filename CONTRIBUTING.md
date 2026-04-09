# Contributing to Nuclei

Thank you for your interest in contributing to Nuclei. This document explains how to set up your development environment, the code style we follow, and the process for submitting changes.

---

## Development Setup

### Prerequisites

- **Node.js** 20+ (check with `node --version`)
- **Rust** latest stable (install via [rustup.rs](https://rustup.rs/))
- **Python** 3.10+ with pip
- **Tauri CLI**: `cargo install tauri-cli`

### Getting Started

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/nuclei.git
cd nuclei

# Install frontend dependencies
npm install

# Install Python kernel dependencies
pip install -r kernel/requirements.txt

# Copy the environment template
cp .env.example .env

# Start the dev server
npm run tauri dev
```

This launches the Tauri window with hot module replacement. Frontend changes reflect immediately; Rust changes trigger an automatic rebuild.

### Running Tests

```bash
npm test              # Frontend (Vitest)
cargo test            # Rust backend
cd kernel && pytest   # Python kernel
```

---

## Code Style

### TypeScript (Frontend)

- **Strict mode** enabled in `tsconfig.json`. No `any` types unless explicitly justified.
- Functional React components with hooks only. No class components.
- All shared state goes through Zustand stores. No prop drilling.
- Format with Prettier. Lint with ESLint.

### Rust (Backend)

- Run `cargo fmt` before committing. All code must pass `cargo fmt --check`.
- Run `cargo clippy` and resolve all warnings. Clippy warnings are treated as errors in CI.
- Follow standard Tauri patterns for IPC commands and plugin usage.

### Python (Kernel)

- Format with **Black** (default settings).
- Lint with **Ruff**.
- Use type hints on all function signatures.
- Use dataclasses for structured data (see `kernel/models/`).

### General

- Files should stay under 800 lines. Extract utilities or split modules when they grow.
- Functions should stay under 50 lines.
- Handle errors explicitly. Never silently swallow exceptions or errors.
- No hardcoded secrets, API keys, or credentials in source code.

---

## Commit Messages

We use conventional commit format:

```
<type>: <short description>

<optional longer explanation>
```

### Types

| Type | Use For |
|------|---------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependency updates |
| `perf` | Performance improvement |

### Examples

```
feat: add gate parameter tooltips to circuit diagram
fix: prevent Bloch sphere crash on zero-state vector
refactor: extract WebSocket reconnection logic into hook
docs: add CUDA-Q adapter usage examples
test: add integration tests for Cirq adapter
```

Keep the first line under 72 characters. Use the body for context when the change is not obvious from the title alone.

---

## Pull Request Process

1. **Create a branch** from `main` with a descriptive name:
   ```
   feat/gate-tooltips
   fix/bloch-sphere-zero-state
   ```

2. **Make your changes.** Keep PRs focused on a single concern. Large changes should be broken into a series of smaller PRs when possible.

3. **Write or update tests.** New features need tests. Bug fixes should include a regression test.

4. **Run the full check suite locally** before pushing:
   ```bash
   npm test
   cargo test
   cargo fmt --check
   cargo clippy
   cd kernel && pytest
   ```

5. **Open a pull request** against `main`. Include:
   - A clear title following commit message conventions
   - A description of what changed and why
   - Screenshots or screen recordings for UI changes
   - Any testing instructions reviewers should follow

6. **Address review feedback.** Push additional commits to the PR branch rather than force-pushing, so reviewers can see incremental changes.

7. **Merge.** Once approved and CI passes, the PR will be squash-merged into `main`.

---

## Reporting Issues

### Bugs

Use the [bug report template](https://github.com/calelamb/nuclei/issues/new?template=bug_report.md). Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Nuclei version, quantum framework)

### Feature Requests

Use the [feature request template](https://github.com/calelamb/nuclei/issues/new?template=feature_request.md). Describe the problem you are trying to solve before proposing a solution.

---

## Project Structure

```
nuclei/
├── src-tauri/       # Rust backend (Tauri shell, IPC commands)
├── src/             # React frontend (editor, visualizations, Dirac)
├── kernel/          # Python kernel (WebSocket server, framework adapters)
├── public/          # Static assets
└── scripts/         # Build and utility scripts
```

For detailed architecture documentation, see [CLAUDE.md](CLAUDE.md).

---

## License

By contributing to Nuclei, you agree that your contributions will be licensed under the [MIT License](LICENSE).
