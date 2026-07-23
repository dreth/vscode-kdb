#!/usr/bin/env python3
"""Audit a vscode-kdb VSIX and its one-file distribution wrapper."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zlib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile, ZipInfo


EXPECTED_EXTENSION_NAME = "vscode-kdb"
EXPECTED_PUBLISHER = "DanielAlonso"
VSIX_MANIFEST = "extension.vsixmanifest"
CONTENT_TYPES = "[Content_Types].xml"
PACKAGE_MANIFEST = "extension/package.json"
REQUIRED_VSIX_ASSETS = {
    PACKAGE_MANIFEST,
    "extension/readme.md",
    "extension/LICENSE.txt",
    "extension/changelog.md",
    "extension/icons/kx-marketplace.png",
}

REQUIRED_MEMBERS = {
    VSIX_MANIFEST,
    CONTENT_TYPES,
    PACKAGE_MANIFEST,
    "extension/language-configuration.json",
    "extension/THIRD_PARTY_NOTICES.md",
    "extension/readme.md",
    "extension/LICENSE.txt",
    "extension/changelog.md",
    "extension/icons/kx-activity.png",
    "extension/icons/kx-marketplace.png",
    "extension/renderer/kx-notebook-renderer.js",
    "extension/python/kx_notebook/LICENSE",
    "extension/python/kx_notebook/README.md",
    "extension/python/kx_notebook/pyproject.toml",
    "extension/python/kx_notebook/src/kx_notebook/__init__.py",
    "extension/python/kx_notebook/src/kx_notebook/contract.py",
    "extension/python/kx_notebook/src/kx_notebook/display.py",
    "extension/python/kx_notebook/src/kx_notebook/fallback.py",
    "extension/python/kx_notebook/src/kx_notebook/magic.py",
    "extension/python/kx_notebook/src/kx_notebook/pykx.py",
    "extension/python/kx_notebook/src/kx_notebook/testing.py",
    "extension/syntaxes/q.tmLanguage.json",
}

ALLOWED_EXTENSION_ROOTS = {
    "package.json",
    "language-configuration.json",
    "THIRD_PARTY_NOTICES.md",
    "readme.md",
    "LICENSE.txt",
    "changelog.md",
    "out",
    "icons",
    "syntaxes",
    "node_modules",
    "python",
    "renderer",
}

FORBIDDEN_COMPONENTS = {
    ".git",
    ".github",
    ".vscode",
    ".vscode-test",
    ".cache",
    ".mypy_cache",
    ".nyc_output",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    "coverage",
    "doc",
    "docs",
    "mkdocs-src",
    "prompt",
    "prompts",
    "source",
    "src",
    "temp",
    "test",
    "tests",
    "tmp",
}

FORBIDDEN_FILENAMES = {
    ".git-credentials",
    ".npmrc",
    ".netrc",
    ".pypirc",
    ".python-version",
    ".tool-versions",
    "agents.md",
    "authorized_keys",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "secrets",
    "secrets.json",
}

FORBIDDEN_CREDENTIAL_SUFFIXES = {
    ".jks",
    ".kdbx",
    ".key",
    ".keystore",
    ".p12",
    ".pfx",
    ".pem",
}

FORBIDDEN_SOURCE_SUFFIXES = {".ts", ".tsx", ".mts", ".cts"}
FORBIDDEN_ARCHIVE_SUFFIXES = {
    ".7z",
    ".bz2",
    ".ear",
    ".gz",
    ".jar",
    ".rar",
    ".tar",
    ".tar.bz2",
    ".tar.gz",
    ".tar.xz",
    ".tbz",
    ".tbz2",
    ".tgz",
    ".txz",
    ".vsix",
    ".war",
    ".xz",
    ".zip",
}

RUNTIME_CODE_PREFIXES = (
    "extension/out/",
    "extension/python/kx_notebook/src/",
    "extension/renderer/",
    "extension/syntaxes/",
)
RUNTIME_CODE_MEMBERS = {
    PACKAGE_MANIFEST,
    "extension/language-configuration.json",
}
CONNECTION_MIGRATION_RUNTIME_MEMBER = "extension/out/connection-migration.js"

FORBIDDEN_RUNTIME_INDICATORS = (
    ("SQLTools package import", re.compile(rb"@sqltools/", re.IGNORECASE)),
    ("SQLTools command/configuration", re.compile(rb"(?:^|[^a-z0-9_-])sqltools\.", re.IGNORECASE)),
    (
        "SQLTools module import",
        re.compile(
            rb"(?:(?:require|import)\s*\(\s*|from\s+)[\"'][^\"']*sqltools",
            re.IGNORECASE,
        ),
    ),
    ("SQLTools session file behavior", re.compile(rb"\.session\.sql", re.IGNORECASE)),
    ("vscode-q source/reference", re.compile(rb"(?:jshinonome/)?vscode-q", re.IGNORECASE)),
)
LEGACY_MIGRATION_ALIASES = (
    b"kdb-sqltools",
    b"DanielAlonso.kdb-sqltools",
)
KDB_SQLTOOLS_INDICATOR = re.compile(rb"kdb-sqltools", re.IGNORECASE)

CREDENTIAL_CONTENT_INDICATORS = (
    ("private key", re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(rb"(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])")),
    ("GitHub token", re.compile(rb"(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,}(?![A-Za-z0-9_])")),
    ("npm token", re.compile(rb"(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{30,}(?![A-Za-z0-9_])")),
    ("Slack token", re.compile(rb"(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9])")),
)

WINDOWS_RESERVED_NAMES = {
    "aux",
    "clock$",
    "con",
    "nul",
    "prn",
    *(f"com{number}" for number in range(1, 10)),
    *(f"lpt{number}" for number in range(1, 10)),
}


class AuditError(RuntimeError):
    """A release artifact violates the package contract."""


@dataclass(frozen=True)
class ArchiveData:
    members: dict[str, bytes]
    infos: tuple[ZipInfo, ...]
    file_count: int
    compressed_bytes: int
    unpacked_bytes: int


@dataclass(frozen=True)
class VsixInventory:
    version: str
    file_count: int
    compiled_modules: int
    runtime_packages: int
    compressed_bytes: int
    unpacked_bytes: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit a vscode-kdb VSIX and its one-file wrapper ZIP without extracting either archive."
    )
    parser.add_argument("vsix", type=Path, help="Path to vscode-kdb-VERSION.vsix")
    parser.add_argument("wrapper", type=Path, help="Path to the one-file distribution ZIP")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_archive_name(name: str) -> str:
    return unicodedata.normalize("NFC", name.rstrip("/")).casefold()


def validate_archive_path(name: str, label: str) -> None:
    if not name or "\x00" in name:
        raise AuditError(f"{label}: empty or NUL-containing archive path")
    if "\\" in name:
        raise AuditError(f"{label}: backslash archive path is forbidden: {name!r}")
    if name.startswith(("/", "//")) or re.match(r"^[A-Za-z]:", name):
        raise AuditError(f"{label}: absolute archive path is forbidden: {name!r}")

    trimmed = name[:-1] if name.endswith("/") else name
    parts = trimmed.split("/")
    if not trimmed or any(part in {"", ".", ".."} for part in parts):
        raise AuditError(f"{label}: non-normal archive path is forbidden: {name!r}")
    if PurePosixPath(trimmed).is_absolute() or str(PurePosixPath(trimmed)) != trimmed:
        raise AuditError(f"{label}: unsafe archive path is forbidden: {name!r}")

    for component in parts:
        if ":" in component:
            raise AuditError(f"{label}: colon in archive path component is forbidden: {name!r}")
        if component.endswith((" ", ".")):
            raise AuditError(f"{label}: trailing dot/space in archive path is forbidden: {name!r}")
        windows_stem = component.split(".", 1)[0].casefold()
        if windows_stem in WINDOWS_RESERVED_NAMES:
            raise AuditError(f"{label}: reserved device name in archive path: {name!r}")


def validate_zip_entry_type(info: ZipInfo, label: str) -> None:
    if info.flag_bits & 0x1:
        raise AuditError(f"{label}: encrypted ZIP entry is forbidden: {info.filename!r}")

    mode = info.external_attr >> 16
    if mode and stat.S_ISLNK(mode):
        raise AuditError(f"{label}: symbolic-link ZIP entry is forbidden: {info.filename!r}")
    file_type = stat.S_IFMT(mode) if mode else 0
    if info.is_dir():
        if file_type not in {0, stat.S_IFDIR}:
            raise AuditError(f"{label}: directory entry has an unsafe file type: {info.filename!r}")
    elif file_type not in {0, stat.S_IFREG}:
        raise AuditError(f"{label}: non-regular ZIP entry is forbidden: {info.filename!r}")


def read_archive(path: Path, label: str) -> ArchiveData:
    if path.is_symlink():
        raise AuditError(f"{label}: artifact path must not be a symbolic link: {path}")
    if not path.is_file():
        raise AuditError(f"{label}: artifact is not a regular file: {path}")

    try:
        with ZipFile(path, "r") as archive:
            infos = tuple(archive.infolist())
            raw_names = [info.filename for info in infos]
            duplicates = sorted(name for name, count in Counter(raw_names).items() if count > 1)
            if duplicates:
                raise AuditError(f"{label}: duplicate ZIP member(s): {', '.join(duplicates)}")

            canonical_names: dict[str, str] = {}
            for info in infos:
                validate_archive_path(info.filename, label)
                validate_zip_entry_type(info, label)
                canonical = canonical_archive_name(info.filename)
                previous = canonical_names.get(canonical)
                if previous is not None:
                    raise AuditError(
                        f"{label}: case-fold/Unicode-equivalent ZIP members: {previous!r}, {info.filename!r}"
                    )
                canonical_names[canonical] = info.filename

            file_names = {info.filename.rstrip("/") for info in infos if not info.is_dir()}
            for info in infos:
                parts = info.filename.rstrip("/").split("/")
                for index in range(1, len(parts)):
                    parent = "/".join(parts[:index])
                    if parent in file_names:
                        raise AuditError(
                            f"{label}: file/directory path collision between {parent!r} and {info.filename!r}"
                        )

            bad_crc = archive.testzip()
            if bad_crc is not None:
                raise AuditError(f"{label}: CRC validation failed for {bad_crc!r}")

            members = {
                info.filename: archive.read(info)
                for info in infos
                if not info.is_dir()
            }
    except AuditError:
        raise
    except (BadZipFile, EOFError, RuntimeError, OSError, zlib.error) as error:
        raise AuditError(f"{label}: invalid or unreadable ZIP archive: {error}") from error

    return ArchiveData(
        members=members,
        infos=infos,
        file_count=len(members),
        compressed_bytes=sum(info.compress_size for info in infos if not info.is_dir()),
        unpacked_bytes=sum(info.file_size for info in infos if not info.is_dir()),
    )


def has_suffix(name: str, suffixes: set[str]) -> bool:
    lowered = name.casefold()
    return any(lowered.endswith(suffix) for suffix in suffixes)


def validate_vsix_path_policy(name: str) -> None:
    lowered = name.casefold()
    if lowered in {VSIX_MANIFEST.casefold(), CONTENT_TYPES.casefold()}:
        return
    if not lowered.startswith("extension/"):
        raise AuditError(f"VSIX: unexpected top-level member: {name!r}")

    relative = name[len("extension/"):].rstrip("/")
    if not relative:
        return
    parts = relative.split("/")
    root = parts[0]
    if root not in ALLOWED_EXTENSION_ROOTS:
        raise AuditError(f"VSIX: unexpected extension-root member: {name!r}")

    folded_parts = [part.casefold() for part in parts]
    forbidden = sorted(set(folded_parts) & FORBIDDEN_COMPONENTS)
    if lowered.startswith("extension/python/kx_notebook/src/kx_notebook/"):
        forbidden = [component for component in forbidden if component != "src"]
    if forbidden:
        raise AuditError(f"VSIX: forbidden path component {forbidden[0]!r}: {name!r}")

    basename = folded_parts[-1]
    if basename in FORBIDDEN_FILENAMES or basename == ".env" or basename.startswith(".env."):
        raise AuditError(f"VSIX: credential/local-environment file is forbidden: {name!r}")
    if basename.startswith(("codex", "prompt", "plan", "status")):
        raise AuditError(f"VSIX: prompt/agent work product is forbidden: {name!r}")
    if has_suffix(basename, FORBIDDEN_CREDENTIAL_SUFFIXES):
        raise AuditError(f"VSIX: credential/key file is forbidden: {name!r}")
    if has_suffix(basename, FORBIDDEN_SOURCE_SUFFIXES):
        raise AuditError(f"VSIX: TypeScript source is forbidden: {name!r}")
    if basename.endswith(".map"):
        raise AuditError(f"VSIX: source map is forbidden: {name!r}")
    if has_suffix(basename, FORBIDDEN_ARCHIVE_SUFFIXES):
        raise AuditError(f"VSIX: nested archive is forbidden: {name!r}")
    if basename.endswith((".log", ".pyc", ".pyo")) or basename in {".ds_store", "thumbs.db"}:
        raise AuditError(f"VSIX: cache/log/platform file is forbidden: {name!r}")
    if any(indicator in lowered for indicator in ("vscode-q", "kdb-sqltools", "sqltools")):
        raise AuditError(f"VSIX: forbidden vscode-q/SQLTools path indicator: {name!r}")


def json_object(data: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditError(f"{label}: invalid UTF-8 JSON: {error}") from error
    if not isinstance(value, dict):
        raise AuditError(f"{label}: expected a JSON object")
    return value


def required_extension_member(reference: Any, source: str, members: dict[str, bytes]) -> str:
    if not isinstance(reference, str) or not reference.strip():
        raise AuditError(f"VSIX: {source} must reference a non-empty extension asset path")
    value = reference.strip()
    if value.startswith("$("):
        raise AuditError(f"VSIX: {source} unexpectedly uses a theme icon instead of a packaged asset")
    value = value[2:] if value.startswith("./") else value
    validate_archive_path(value, f"VSIX {source}")
    member = f"extension/{value}"
    if member not in members:
        raise AuditError(f"VSIX: {source} references missing member {member!r}")
    return member


def validate_package_assets(package: dict[str, Any], members: dict[str, bytes]) -> None:
    required_extension_member(package.get("main"), "package.json main", members)
    required_extension_member(package.get("icon"), "package.json icon", members)

    contributes = package.get("contributes", {})
    if not isinstance(contributes, dict):
        raise AuditError("VSIX: package.json contributes must be an object")

    languages = contributes.get("languages", [])
    grammars = contributes.get("grammars", [])
    notebook_renderers = contributes.get("notebookRenderer", [])
    view_containers = contributes.get("viewsContainers", {})
    if not isinstance(languages, list):
        raise AuditError("VSIX: contributes.languages must be an array")
    if not isinstance(grammars, list):
        raise AuditError("VSIX: contributes.grammars must be an array")
    if not isinstance(notebook_renderers, list):
        raise AuditError("VSIX: contributes.notebookRenderer must be an array")
    if not isinstance(view_containers, dict):
        raise AuditError("VSIX: contributes.viewsContainers must be an object")

    for language in languages:
        if isinstance(language, dict) and "configuration" in language:
            required_extension_member(language["configuration"], "language configuration", members)
    for grammar in grammars:
        if isinstance(grammar, dict):
            required_extension_member(grammar.get("path"), "grammar", members)
    for renderer in notebook_renderers:
        if not isinstance(renderer, dict):
            raise AuditError("VSIX: notebook renderer contribution must be an object")
        required_extension_member(renderer.get("entrypoint"), "notebook renderer entrypoint", members)
    for container_group in view_containers.values():
        if not isinstance(container_group, list):
            continue
        for container in container_group:
            if isinstance(container, dict) and "icon" in container:
                required_extension_member(container["icon"], "view container icon", members)

    dependencies = package.get("dependencies", {})
    if dependencies is None:
        dependencies = {}
    if not isinstance(dependencies, dict):
        raise AuditError("VSIX: package.json dependencies must be an object")
    for dependency in dependencies:
        dependency_lower = dependency.casefold()
        if "sqltools" in dependency_lower or "vscode-q" in dependency_lower:
            raise AuditError(f"VSIX: forbidden runtime dependency: {dependency!r}")
        dependency_manifest = f"extension/node_modules/{dependency}/package.json"
        if dependency_manifest not in members:
            raise AuditError(f"VSIX: runtime dependency is missing from the archive: {dependency!r}")

    for field in ("extensionDependencies", "extensionPack"):
        extension_dependencies = package.get(field, [])
        if extension_dependencies is None:
            extension_dependencies = []
        if not isinstance(extension_dependencies, list):
            raise AuditError(f"VSIX: package.json {field} must be an array")
        for dependency in extension_dependencies:
            lowered = str(dependency).casefold()
            if "sqltools" in lowered or "vscode-q" in lowered:
                raise AuditError(f"VSIX: forbidden {field} entry: {dependency!r}")


def validate_vsix_manifest(package: dict[str, Any], members: dict[str, bytes]) -> None:
    try:
        root = ET.fromstring(members[VSIX_MANIFEST])
        content_types_root = ET.fromstring(members[CONTENT_TYPES])
    except ET.ParseError as error:
        raise AuditError(f"VSIX: invalid package XML: {error}") from error

    if root.tag != "{http://schemas.microsoft.com/developer/vsx-schema/2011}PackageManifest":
        raise AuditError("VSIX: extension.vsixmanifest has an unexpected root element")
    if content_types_root.tag != "{http://schemas.openxmlformats.org/package/2006/content-types}Types":
        raise AuditError("VSIX: [Content_Types].xml has an unexpected root element")

    namespace = {"vsx": "http://schemas.microsoft.com/developer/vsx-schema/2011"}
    identity = root.find(".//vsx:Identity", namespace)
    if identity is None:
        raise AuditError("VSIX: extension.vsixmanifest is missing Metadata/Identity")
    expected_identity = {
        "Id": package.get("name"),
        "Version": package.get("version"),
        "Publisher": package.get("publisher"),
    }
    for attribute, expected in expected_identity.items():
        if identity.get(attribute) != expected:
            raise AuditError(
                f"VSIX: manifest Identity {attribute}={identity.get(attribute)!r}, expected {expected!r}"
            )

    references: list[tuple[str, str]] = []
    asset_paths: set[str] = set()
    for asset in root.findall(".//vsx:Asset", namespace):
        path = asset.get("Path", "")
        asset_paths.add(path)
        references.append(("VSIX Asset", path))
    missing_assets = sorted(REQUIRED_VSIX_ASSETS - asset_paths)
    if missing_assets:
        raise AuditError(f"VSIX: manifest Asset reference(s) missing: {', '.join(missing_assets)}")

    for element_name, expected_path in (
        ("License", "extension/LICENSE.txt"),
        ("Icon", "extension/icons/kx-marketplace.png"),
    ):
        element = root.find(f".//vsx:{element_name}", namespace)
        actual_path = element.text.strip() if element is not None and element.text else ""
        if actual_path != expected_path:
            raise AuditError(
                f"VSIX: manifest {element_name} is {actual_path!r}, expected {expected_path!r}"
            )
        references.append((f"VSIX {element_name}", actual_path))
    for source, member in references:
        validate_archive_path(member, source)
        if member not in members:
            raise AuditError(f"VSIX: {source} references missing member {member!r}")


def validate_repository_manifest(package: dict[str, Any]) -> None:
    repository_root = Path(__file__).resolve().parents[1]
    manifest_path = repository_root / "package.json"
    if not manifest_path.is_file():
        return
    try:
        repository_package = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuditError(f"repository package.json is unreadable: {error}") from error
    for field in ("name", "version", "publisher"):
        if package.get(field) != repository_package.get(field):
            raise AuditError(
                f"VSIX: packaged {field}={package.get(field)!r} does not match repository package.json "
                f"({repository_package.get(field)!r})"
            )


def validate_compiled_inventory(members: dict[str, bytes]) -> None:
    repository_root = Path(__file__).resolve().parents[1]
    source_root = repository_root / "src"
    if not source_root.is_dir():
        return
    expected = {
        "extension/out/" + source.relative_to(source_root).with_suffix(".js").as_posix()
        for source in source_root.rglob("*.ts")
        if source.is_file()
    }
    actual = {
        name
        for name in members
        if name.startswith("extension/out/")
    }
    missing = sorted(expected - actual)
    stale = sorted(actual - expected)
    if missing:
        raise AuditError(f"VSIX: compiled module(s) missing: {', '.join(missing)}")
    if stale:
        raise AuditError(f"VSIX: stale/unexpected compiled output: {', '.join(stale)}")


def validate_runtime_indicators(members: dict[str, bytes]) -> None:
    for name, payload in members.items():
        for description, pattern in CREDENTIAL_CONTENT_INDICATORS:
            if pattern.search(payload):
                raise AuditError(f"VSIX: possible {description} content found in {name!r}")

        is_runtime_code = name in RUNTIME_CODE_MEMBERS or name.startswith(RUNTIME_CODE_PREFIXES)
        if not is_runtime_code:
            continue
        for description, pattern in FORBIDDEN_RUNTIME_INDICATORS:
            if pattern.search(payload):
                raise AuditError(f"VSIX: forbidden {description} indicator found in {name!r}")

        if KDB_SQLTOOLS_INDICATOR.search(payload):
            if name != CONNECTION_MIGRATION_RUNTIME_MEMBER:
                raise AuditError(
                    f"VSIX: kdb-sqltools reference is permitted only in the one-shot migration bridge, found in {name!r}"
                )
            scrubbed = payload
            for alias in sorted(LEGACY_MIGRATION_ALIASES, key=len, reverse=True):
                scrubbed = scrubbed.replace(alias, b"")
            if KDB_SQLTOOLS_INDICATOR.search(scrubbed):
                raise AuditError(
                    f"VSIX: migration bridge contains a non-schema kdb-sqltools reference in {name!r}"
                )

    bridge = members.get(CONNECTION_MIGRATION_RUNTIME_MEMBER)
    if bridge is None:
        raise AuditError("VSIX: compiled one-shot connection migration bridge is missing")
    for required in (*LEGACY_MIGRATION_ALIASES, b"'sqltools'", b"'connections'"):
        if required not in bridge:
            raise AuditError(
                f"VSIX: migration bridge is missing required schema marker {required.decode('ascii')!r}"
            )
    if b"onDidChangeConfiguration" in bridge:
        raise AuditError("VSIX: migration bridge must not register permanent configuration synchronization")


def audit_vsix(path: Path) -> VsixInventory:
    archive = read_archive(path, "VSIX")
    for info in archive.infos:
        validate_vsix_path_policy(info.filename)

    missing = sorted(REQUIRED_MEMBERS - archive.members.keys())
    if missing:
        raise AuditError(f"VSIX: required member(s) missing: {', '.join(missing)}")

    package = json_object(archive.members[PACKAGE_MANIFEST], "VSIX package.json")
    if package.get("name") != EXPECTED_EXTENSION_NAME:
        raise AuditError(
            f"VSIX: package name is {package.get('name')!r}, expected {EXPECTED_EXTENSION_NAME!r}"
        )
    if package.get("publisher") != EXPECTED_PUBLISHER:
        raise AuditError(
            f"VSIX: publisher is {package.get('publisher')!r}, expected {EXPECTED_PUBLISHER!r}"
        )
    if package.get("main") != "./out/extension.js":
        raise AuditError(f"VSIX: package main is {package.get('main')!r}, expected './out/extension.js'")
    version = package.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise AuditError(f"VSIX: invalid package version {version!r}")
    expected_filename = f"{EXPECTED_EXTENSION_NAME}-{version}.vsix"
    if path.name != expected_filename:
        raise AuditError(f"VSIX: filename is {path.name!r}, expected {expected_filename!r}")

    validate_package_assets(package, archive.members)
    validate_vsix_manifest(package, archive.members)
    validate_repository_manifest(package)
    validate_compiled_inventory(archive.members)
    validate_runtime_indicators(archive.members)

    compiled_modules = sum(
        name.startswith("extension/out/") and name.endswith(".js")
        for name in archive.members
    )
    if compiled_modules == 0:
        raise AuditError("VSIX: no compiled extension modules found under extension/out/")
    runtime_packages = sum(
        name.startswith("extension/node_modules/") and name.endswith("/package.json")
        for name in archive.members
    )
    return VsixInventory(
        version=version,
        file_count=archive.file_count,
        compiled_modules=compiled_modules,
        runtime_packages=runtime_packages,
        compressed_bytes=archive.compressed_bytes,
        unpacked_bytes=archive.unpacked_bytes,
    )


def audit_wrapper(path: Path, vsix_path: Path, vsix_bytes: bytes) -> ArchiveData:
    archive = read_archive(path, "wrapper ZIP")
    if len(archive.infos) != 1 or archive.file_count != 1:
        raise AuditError(
            f"wrapper ZIP: expected exactly one file entry, found {len(archive.infos)} entries/{archive.file_count} files"
        )
    info = archive.infos[0]
    if info.is_dir() or info.filename != vsix_path.name or PurePosixPath(info.filename).name != info.filename:
        raise AuditError(
            f"wrapper ZIP: sole member must be basename {vsix_path.name!r}, found {info.filename!r}"
        )
    if archive.members[info.filename] != vsix_bytes:
        raise AuditError("wrapper ZIP: embedded VSIX bytes do not exactly match the supplied VSIX")
    return archive


def format_bytes(value: int) -> str:
    return f"{value:,} B"


def run() -> int:
    args = parse_args()
    vsix_path: Path = args.vsix
    wrapper_path: Path = args.wrapper
    if os.path.abspath(vsix_path) == os.path.abspath(wrapper_path):
        raise AuditError("VSIX and wrapper ZIP paths must be different files")

    inventory = audit_vsix(vsix_path)
    expected_wrapper_name = f"{EXPECTED_EXTENSION_NAME}-{inventory.version}-vsix.zip"
    if wrapper_path.name != expected_wrapper_name:
        raise AuditError(
            f"wrapper ZIP: filename is {wrapper_path.name!r}, expected {expected_wrapper_name!r}"
        )
    vsix_bytes = vsix_path.read_bytes()
    wrapper = audit_wrapper(wrapper_path, vsix_path, vsix_bytes)
    vsix_sha256 = sha256_file(vsix_path)
    wrapper_sha256 = sha256_file(wrapper_path)

    print("release artifact audit: OK")
    print(
        f"VSIX: {vsix_path.name} | version {inventory.version} | {inventory.file_count} files | "
        f"{inventory.compiled_modules} compiled modules | {inventory.runtime_packages} runtime packages | "
        f"{format_bytes(inventory.compressed_bytes)} compressed | {format_bytes(inventory.unpacked_bytes)} unpacked"
    )
    print(f"VSIX SHA-256: {vsix_sha256}")
    print(
        f"wrapper: {wrapper_path.name} | 1 file | {format_bytes(wrapper.compressed_bytes)} compressed | "
        f"{format_bytes(wrapper.unpacked_bytes)} unpacked | raw VSIX bytes verified"
    )
    print(f"wrapper SHA-256: {wrapper_sha256}")
    return 0


def main() -> int:
    try:
        return run()
    except AuditError as error:
        print(f"release artifact audit: FAILED: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"release artifact audit: FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
