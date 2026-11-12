#!/usr/bin/env python3
"""Keep the committed sitemap when a rebuild changed only its build stamps.

MkDocs writes the build date into every <lastmod> of sitemap.xml and
sitemap.xml.gz, and the gzip bytes also depend on the zlib build. Neither means
the committed docs are stale, yet both made "Verify generated docs are
committed" fail whenever CI built on a later day than the commit, or on a
runner with a different zlib. When the rebuilt sitemap matches the committed
one apart from those stamps, put the committed files back; any other change
(a page added, removed or renamed) stays for `git diff` to report.
"""

from pathlib import Path
import gzip
import re
import subprocess
import sys


LASTMOD = re.compile(rb"\s*<lastmod>[^<]*</lastmod>")


def committed(path: Path) -> bytes | None:
    result = subprocess.run(
        ["git", "show", f"HEAD:{path.as_posix()}"], capture_output=True, check=False
    )
    return result.stdout if result.returncode == 0 else None


def without_dates(xml: bytes) -> bytes:
    return LASTMOD.sub(b"", xml)


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs")
    xml_path, gz_path = root / "sitemap.xml", root / "sitemap.xml.gz"
    old_xml, old_gz = committed(xml_path), committed(gz_path)
    if old_xml is None or old_gz is None:
        return 0
    if not xml_path.is_file() or not gz_path.is_file():
        return 0

    same_xml = without_dates(xml_path.read_bytes()) == without_dates(old_xml)
    same_gz = without_dates(gzip.decompress(gz_path.read_bytes())) == without_dates(
        gzip.decompress(old_gz)
    )
    if same_xml and same_gz:
        xml_path.write_bytes(old_xml)
        gz_path.write_bytes(old_gz)
        print("Sitemap differs only in build dates; kept the committed copy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
