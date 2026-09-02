# Repository Identity Hygiene Specification

## Purpose

Defines tracked-content hygiene for prohibited third-party identity references while preserving clean-room provenance and release safeguards.

## Requirements

### Requirement: Tracked repository content excludes the prohibited third-party identity

The repository SHALL contain no tracked plaintext occurrence of the prohibited third-party author identity or package-owner handle, including case, punctuation, separator, and spacing variants. This requirement SHALL apply to source, tests, scripts, documentation, provenance, changelog entries, generated documentation, fixtures, snapshots, and archived OpenSpec artifacts.

Identity cleanup SHALL preserve relevant engineering and legal boundaries using generic wording. In particular, release checks SHALL continue to reject prohibited third-party package-family references and copied runtime artifacts without requiring an owner-qualified path or identity-specific attribution.

The repository SHALL include an automated tracked-content audit that compares normalized candidate text with cryptographic digests of the prohibited forms. The audit, its fixtures, its comments, and its failure output SHALL NOT store or reconstruct the prohibited plaintext. Existing Git commit objects, tags, and remote history are outside this tracked-content contract.

#### Scenario: Clean tracked tree passes the identity audit

- **WHEN** the repository hygiene audit scans every tracked text file
- **THEN** no normalized candidate matches a prohibited-form digest
- **AND** the audit exits successfully without printing or reconstructing prohibited plaintext

#### Scenario: Audit logic rejects a normalized canary

- **WHEN** a synthetic fixture contains a harmless canary in case, punctuation, separator, or spacing variants
- **THEN** the same normalization-and-digest pipeline rejects every canary variant
- **AND** production prohibited-form digests remain opaque test data

#### Scenario: Clean-room provenance remains enforceable

- **WHEN** identity-specific wording is removed from provenance, historical intent, tests, and release scripts
- **THEN** identity-neutral documentation still records that no source or runtime artifacts were copied from an all-rights-reserved third-party q extension
- **AND** the release audit still rejects references to the disallowed package family and unexpected packaged artifacts
