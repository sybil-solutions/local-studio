// CRITICAL
import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

export interface DistributedNodeRecord {
  node_id: string;
  label: string | null;
  backend: string | null;
  transport: string | null;
  host: string | null;
  port: number | null;
  capabilities: string;
  metrics: string;
  status: string;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface DistributedAllocationRecord {
  model_id: string;
  node_id: string;
  start_layer: number;
  end_layer: number;
  updated_at: string;
}

export interface DistributedNodeUpsert {
  node_id: string;
  label: string | null;
  backend: string | null;
  transport: string | null;
  host: string | null;
  port: number | null;
  capabilities: string;
  metrics: string;
  status: string;
  last_heartbeat_at: string;
}

/**
 * SQLite-backed store for distributed node/control-plane state.
 */
export class DistributedStore {
  private readonly db: Database;

  /**
   * Create the store and run schema migrations.
   * @param dbPath - SQLite path.
   */
  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  /**
   * Ensure distributed schema exists.
   */
  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS distributed_nodes (
        node_id TEXT PRIMARY KEY,
        label TEXT,
        backend TEXT,
        transport TEXT,
        host TEXT,
        port INTEGER,
        capabilities TEXT NOT NULL DEFAULT '{}',
        metrics TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'online',
        last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS distributed_allocations (
        model_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        start_layer INTEGER NOT NULL,
        end_layer INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (model_id, node_id),
        FOREIGN KEY(node_id) REFERENCES distributed_nodes(node_id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Insert or update a node registration record.
   * @param node - Normalized node payload.
   */
  public upsertNode(node: DistributedNodeUpsert): void {
    this.db
      .query(
        `
        INSERT INTO distributed_nodes (
          node_id, label, backend, transport, host, port,
          capabilities, metrics, status, last_heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(node_id) DO UPDATE SET
          label = excluded.label,
          backend = excluded.backend,
          transport = excluded.transport,
          host = excluded.host,
          port = excluded.port,
          capabilities = excluded.capabilities,
          metrics = excluded.metrics,
          status = excluded.status,
          last_heartbeat_at = excluded.last_heartbeat_at,
          updated_at = datetime('now')
      `,
      )
      .run(
        node.node_id,
        node.label,
        node.backend,
        node.transport,
        node.host,
        node.port,
        node.capabilities,
        node.metrics,
        node.status,
        node.last_heartbeat_at,
      );
  }

  /**
   * Update heartbeat/metrics for a node.
   * @param nodeId - Node id.
   * @param metrics - JSON string metrics payload.
   * @param status - Current status.
   * @param lastHeartbeatAt - ISO timestamp.
   * @returns True if node exists.
   */
  public touchHeartbeat(
    nodeId: string,
    metrics: string,
    status: string,
    lastHeartbeatAt: string,
  ): boolean {
    const result = this.db
      .query(
        `
        UPDATE distributed_nodes
        SET metrics = ?, status = ?, last_heartbeat_at = ?, updated_at = datetime('now')
        WHERE node_id = ?
      `,
      )
      .run(metrics, status, lastHeartbeatAt, nodeId);
    return result.changes > 0;
  }

  /**
   * Get one node by id.
   * @param nodeId - Node id.
   * @returns Node record or null.
   */
  public getNode(nodeId: string): DistributedNodeRecord | null {
    return (
      (this.db
        .query("SELECT * FROM distributed_nodes WHERE node_id = ?")
        .get(nodeId) as DistributedNodeRecord | null) ?? null
    );
  }

  /**
   * List all registered nodes.
   * @returns Node rows.
   */
  public listNodes(): DistributedNodeRecord[] {
    return this.db
      .query("SELECT * FROM distributed_nodes ORDER BY updated_at DESC")
      .all() as DistributedNodeRecord[];
  }

  /**
   * Upsert manual layer allocation for a node/model.
   * @param modelId - Model id.
   * @param nodeId - Node id.
   * @param startLayer - Inclusive start.
   * @param endLayer - Exclusive end.
   */
  public upsertAllocation(
    modelId: string,
    nodeId: string,
    startLayer: number,
    endLayer: number,
  ): void {
    this.db
      .query(
        `
        INSERT INTO distributed_allocations (model_id, node_id, start_layer, end_layer, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(model_id, node_id) DO UPDATE SET
          start_layer = excluded.start_layer,
          end_layer = excluded.end_layer,
          updated_at = datetime('now')
      `,
      )
      .run(modelId, nodeId, startLayer, endLayer);
  }

  /**
   * Delete an allocation for one node/model.
   * @param modelId - Model id.
   * @param nodeId - Node id.
   * @returns True if deleted.
   */
  public deleteAllocation(modelId: string, nodeId: string): boolean {
    const result = this.db
      .query("DELETE FROM distributed_allocations WHERE model_id = ? AND node_id = ?")
      .run(modelId, nodeId);
    return result.changes > 0;
  }

  /**
   * List allocations, optionally for one model.
   * @param modelId - Optional model filter.
   * @returns Allocation rows.
   */
  public listAllocations(modelId?: string): DistributedAllocationRecord[] {
    if (modelId) {
      return this.db
        .query(
          "SELECT * FROM distributed_allocations WHERE model_id = ? ORDER BY start_layer, node_id",
        )
        .all(modelId) as DistributedAllocationRecord[];
    }
    return this.db
      .query("SELECT * FROM distributed_allocations ORDER BY model_id, start_layer, node_id")
      .all() as DistributedAllocationRecord[];
  }
}
