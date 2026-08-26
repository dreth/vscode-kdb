#!/usr/bin/env python3
"""Guard the legacy GitHub Pages root route and MkDocs public URL."""

from pathlib import Path


PUBLIC_DOCS_URL = "https://vscode-kdb.dac.sg/docs/"


def require_contains(path: Path, expected: str) -> None:
    content = path.read_text(encoding="utf-8")
    if expected not in content:
        raise SystemExit(f"{path} must contain {expected!r}")


def main() -> int:
    require_contains(Path("mkdocs.yml"), f"site_url: {PUBLIC_DOCS_URL}")
    require_contains(Path("index.html"), 'content="0; url=/docs/"')
    require_contains(Path("index.html"), "window.location.replace('/docs/')")
    require_contains(Path("index.html"), f'href="{PUBLIC_DOCS_URL}"')
    require_contains(Path("docs/sitemap.xml"), f"<loc>{PUBLIC_DOCS_URL}</loc>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
