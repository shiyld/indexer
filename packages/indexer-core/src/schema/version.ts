/**
 * Version of the indexer's versioned API contract itself — independent of the public
 * indexer package's own semver (see CLAUDE.md's "Indexer: Full Design & Public
 * Distribution Plan"). A client checks this (via /health) to decide whether it
 * understands a given indexer instance's response shapes, self-hosted or not.
 */
export const API_CONTRACT_VERSION = "1.0.0";
