# /docs — Project Documentation

Central documentation for the Cruzonic Fleet Management Platform.

## Contents

| File | Description |
|------|-------------|
| [architecture.md](architecture.md) | System architecture overview, component data flow |
| [architecture-diagram.drawio](architecture-diagram.drawio) | **Full system diagram** — open with [diagrams.net](https://app.diagrams.net) |
| [eld-data-flow.md](eld-data-flow.md) | End-to-end ELD data flow: hardware → SDK → backend → FMCSA output |
| [fmcsa-compliance-output.md](fmcsa-compliance-output.md) | FMCSA `.erod` file spec, HOS rules engine, transfer methods |
| [database-schema.md](database-schema.md) | Supabase table definitions and relationships |
| [api-reference.md](api-reference.md) | Backend REST API endpoint reference |
| [auth-flow.md](auth-flow.md) | Authentication & authorization design |
| [mobile-deployment.md](mobile-deployment.md) | EAS Build & App Store / Play Store submission guide |
| [portal-deployment.md](portal-deployment.md) | Web portal deployment (Vercel / Nginx) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch conventions, commit style, PR process |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Opening the Architecture Diagram

The file `architecture-diagram.drawio` is a native draw.io XML file showing all system components with color-coded layers and data-flow arrows.

**Option A — Browser (no install):**
1. Go to [app.diagrams.net](https://app.diagrams.net)
2. **File → Open from → Device**, select `docs/architecture-diagram.drawio`

**Option B — VS Code:**
Install the [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) extension — `.drawio` files open directly in the editor.

**Option C — Desktop app:**
Download [diagrams.net desktop](https://github.com/jgraph/drawio-desktop/releases) and open the file directly.

## Quick Links

- **Local dev setup:** See root [README.md](../README.md)
- **Backend setup:** [../backend/README.md](../backend/README.md)
- **Mobile setup:** [../mobile/README.md](../mobile/README.md)
- **Portal setup:** [../portal/README.md](../portal/README.md)
- **Infra / Supabase setup:** [../infra/README.md](../infra/README.md)

## Documentation Standards

- Write in plain Markdown.
- Keep diagrams as [Mermaid](https://mermaid.js.org/) code blocks (rendered in GitHub).
- Update `api-reference.md` and `database-schema.md` whenever you add/change endpoints or migrations.
- Add a changelog entry for every release under `CHANGELOG.md`.
