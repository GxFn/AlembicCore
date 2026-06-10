export default function migrate(db: import('better-sqlite3').Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_graph_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      repo_id TEXT NOT NULL DEFAULT 'default',
      graph_root TEXT NOT NULL,
      project_scope TEXT,
      status TEXT NOT NULL DEFAULT 'indexed',
      extraction_version TEXT NOT NULL DEFAULT 'source-graph-v1',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      indexed_at INTEGER,
      freshness_status TEXT NOT NULL DEFAULT 'fresh',
      freshness_checked_at INTEGER NOT NULL,
      freshness_reason TEXT,
      freshness_next_action TEXT,
      pending_file_count INTEGER NOT NULL DEFAULT 0,
      stale_file_count INTEGER NOT NULL DEFAULT 0,
      degraded_reason TEXT,
      language_coverage_json TEXT NOT NULL DEFAULT '[]',
      file_count INTEGER NOT NULL DEFAULT 0,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      edge_count INTEGER NOT NULL DEFAULT 0,
      parse_error_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS source_graph_generations_generation_unique
      ON source_graph_generations(generation_id);
    CREATE INDEX IF NOT EXISTS idx_sgg_project
      ON source_graph_generations(project_root, repo_id);
    CREATE INDEX IF NOT EXISTS idx_sgg_status
      ON source_graph_generations(status);
    CREATE INDEX IF NOT EXISTS idx_sgg_indexed_at
      ON source_graph_generations(indexed_at);

    CREATE TABLE IF NOT EXISTS source_graph_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      repo_relative_path TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'unknown',
      content_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL,
      classification TEXT NOT NULL DEFAULT 'source',
      parse_status TEXT NOT NULL DEFAULT 'parsed',
      parse_errors_json TEXT NOT NULL DEFAULT '[]',
      line_count INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS source_graph_files_generation_path_unique
      ON source_graph_files(generation_id, repo_relative_path);
    CREATE INDEX IF NOT EXISTS idx_sgf_project_path
      ON source_graph_files(project_root, repo_relative_path);
    CREATE INDEX IF NOT EXISTS idx_sgf_generation
      ON source_graph_files(generation_id);
    CREATE INDEX IF NOT EXISTS idx_sgf_hash
      ON source_graph_files(content_hash);
    CREATE INDEX IF NOT EXISTS idx_sgf_classification
      ON source_graph_files(classification);
    CREATE INDEX IF NOT EXISTS idx_sgf_parse_status
      ON source_graph_files(parse_status);

    CREATE TABLE IF NOT EXISTS source_graph_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      symbol_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      qualified_name TEXT,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      start_column INTEGER NOT NULL DEFAULT 0,
      end_line INTEGER NOT NULL,
      end_column INTEGER NOT NULL DEFAULT 0,
      selection_start_line INTEGER,
      selection_start_column INTEGER,
      selection_end_line INTEGER,
      selection_end_column INTEGER,
      signature TEXT,
      container_symbol_id TEXT,
      exported INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      provenance_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS source_graph_symbols_generation_symbol_unique
      ON source_graph_symbols(generation_id, symbol_id);
    CREATE INDEX IF NOT EXISTS idx_sgs_project
      ON source_graph_symbols(project_root);
    CREATE INDEX IF NOT EXISTS idx_sgs_generation
      ON source_graph_symbols(generation_id);
    CREATE INDEX IF NOT EXISTS idx_sgs_file
      ON source_graph_symbols(file_path);
    CREATE INDEX IF NOT EXISTS idx_sgs_kind
      ON source_graph_symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_sgs_display_name
      ON source_graph_symbols(display_name);
    CREATE INDEX IF NOT EXISTS idx_sgs_container
      ON source_graph_symbols(container_symbol_id);

    CREATE TABLE IF NOT EXISTS source_graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      from_symbol_id TEXT,
      to_symbol_id TEXT,
      from_file_path TEXT,
      to_file_path TEXT,
      site_file_path TEXT,
      site_start_line INTEGER,
      site_start_column INTEGER,
      site_end_line INTEGER,
      site_end_column INTEGER,
      provenance TEXT NOT NULL DEFAULT 'deterministic',
      confidence REAL NOT NULL DEFAULT 1,
      source TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS source_graph_edges_generation_edge_unique
      ON source_graph_edges(generation_id, edge_id);
    CREATE INDEX IF NOT EXISTS idx_sge_project
      ON source_graph_edges(project_root);
    CREATE INDEX IF NOT EXISTS idx_sge_generation
      ON source_graph_edges(generation_id);
    CREATE INDEX IF NOT EXISTS idx_sge_kind
      ON source_graph_edges(kind);
    CREATE INDEX IF NOT EXISTS idx_sge_from_symbol
      ON source_graph_edges(from_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_sge_to_symbol
      ON source_graph_edges(to_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_sge_from_file
      ON source_graph_edges(from_file_path);
    CREATE INDEX IF NOT EXISTS idx_sge_to_file
      ON source_graph_edges(to_file_path);
    CREATE INDEX IF NOT EXISTS idx_sge_provenance
      ON source_graph_edges(provenance);
  `);
}
