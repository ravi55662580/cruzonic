# Contributing Guide

## Branch Conventions

| Prefix | When to use |
|--------|-------------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `chore/` | Tooling, dependencies, config |
| `docs/` | Documentation only |
| `refactor/` | Code restructure with no behaviour change |
| `test/` | Tests only |

Example: `feat/trip-history-pagination`

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

Examples:
```
feat(trips): add pagination to trip history endpoint
fix(mobile): correct GPS accuracy threshold
chore(deps): bump @supabase/supabase-js to 2.44.0
```

## Pull Request Process

1. Branch off `main` (or `dev` if used).
2. Keep PRs focused — one concern per PR.
3. Fill in the PR template (description, test plan, screenshots if UI).
4. All CI checks must pass before merging.
5. At least one peer review required.
6. Squash-merge into `main`.

## Code Style

- TypeScript strict mode is enforced across all packages.
- Run `npm run lint` and `npm run typecheck` before pushing.
- Shared types belong in `/shared` — do not duplicate them.
