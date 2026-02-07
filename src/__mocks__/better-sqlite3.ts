// Mock for better-sqlite3 to avoid native module issues in tests

// In-memory data store for mock database
const mockTables: Map<string, Map<number, any>> = new Map();
let autoIncrementCounters: Map<string, number> = new Map();

class MockStatement {
  private sql: string;
  private db: MockDatabase;

  constructor(sql: string, db: MockDatabase) {
    this.sql = sql;
    this.db = db;
  }

  run(...params: any[]) {
    const sql = this.sql.toLowerCase();

    // Handle INSERT OR REPLACE (for settings table)
    if (sql.includes("insert or replace into")) {
      const tableMatch = sql.match(/insert or replace into (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        if (!mockTables.has(tableName)) {
          mockTables.set(tableName, new Map());
        }
        const table = mockTables.get(tableName)!;

        // Parse column names and values
        const columnsMatch = sql.match(/\(([^)]+)\)/);
        const valuesMatch = sql.match(/values\s*\(([^)]+)\)/);

        if (columnsMatch && valuesMatch) {
          const columns = columnsMatch[1].split(",").map((c) => c.trim());
          const row: any = {};

          columns.forEach((col, idx) => {
            row[col] = params[idx];
          });

          // For settings table, use 'key' as the unique identifier
          if (tableName === "settings" && row.key) {
            // Find existing row with same key
            let existingId = null;
            for (const [id, existingRow] of table.entries()) {
              if (existingRow.key === row.key) {
                existingId = id;
                break;
              }
            }

            if (existingId !== null) {
              // Update existing row
              row.id = existingId;
              table.set(existingId, row);
              return { changes: 1, lastInsertRowid: existingId };
            }
          }

          // Insert new row
          const id = (autoIncrementCounters.get(tableName) || 0) + 1;
          autoIncrementCounters.set(tableName, id);
          row.id = id;
          table.set(id, row);
          return { changes: 1, lastInsertRowid: id };
        }
      }
    }

    // Handle INSERT
    if (sql.includes("insert into")) {
      const tableMatch = sql.match(/insert into (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        if (!mockTables.has(tableName)) {
          mockTables.set(tableName, new Map());
        }
        const table = mockTables.get(tableName)!;
        const id = (autoIncrementCounters.get(tableName) || 0) + 1;
        autoIncrementCounters.set(tableName, id);

        // Parse column names and values
        const columnsMatch = sql.match(/\(([^)]+)\)/);
        const valuesMatch = sql.match(/values\s*\(([^)]+)\)/);

        if (columnsMatch && valuesMatch) {
          const columns = columnsMatch[1].split(",").map((c) => c.trim());
          const row: any = { id };

          columns.forEach((col, idx) => {
            row[col] = params[idx];
          });

          // Add timestamp if not provided
          if (!row.recorded_at && !row.timestamp) {
            row.recorded_at = new Date().toISOString();
          }

          table.set(id, row);
        }

        return { changes: 1, lastInsertRowid: id };
      }
    }

    // Handle DELETE
    if (sql.includes("delete from")) {
      const tableMatch = sql.match(/delete from (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const table = mockTables.get(tableName);
        if (table) {
          const size = table.size;
          table.clear();
          return { changes: size, lastInsertRowid: 0 };
        }
      }
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  get(...params: any[]) {
    const sql = this.sql.toLowerCase();

    // Handle SELECT with WHERE
    if (sql.includes("select") && sql.includes("from")) {
      const tableMatch = sql.match(/from (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const table = mockTables.get(tableName);
        if (table) {
          let rows = Array.from(table.values());

          // Apply WHERE filter if present
          if (sql.includes("where") && params.length > 0) {
            rows = rows.filter((row) => {
              // Simple metric_name filter
              if (sql.includes("metric_name")) {
                return row.metric_name === params[0];
              }
              // Simple key filter for settings table
              if (sql.includes("key")) {
                return row.key === params[0];
              }
              // Date range filter for activity_logs
              if (sql.includes("date(timestamp") && params.length >= 2) {
                const rowDate = row.timestamp?.split(" ")[0] || "";
                const startDate = params[0];
                const endDate = params[1];
                return rowDate >= startDate && rowDate <= endDate;
              }
              return true;
            });
          }

          // Handle aggregate queries (SUM, COUNT, etc.)
          if (sql.includes("sum(") || sql.includes("coalesce(")) {
            // Calculate aggregates for activity_logs
            if (tableName === "activity_logs") {
              let idle_seconds = 0;
              let active_seconds = 0;
              let total_seconds = 0;

              rows.forEach((row) => {
                const duration = row.duration || 0;
                total_seconds += duration;

                if (row.app_name === "System" && row.window_title === "Idle") {
                  idle_seconds += duration;
                } else {
                  active_seconds += duration;
                }
              });

              return {
                idle_seconds,
                active_seconds,
                total_seconds,
              };
            }
          }

          // Return first row for non-aggregate queries
          return rows[0] || null;
        }
      }
    }

    return null;
  }

  all(...params: any[]) {
    const sql = this.sql.toLowerCase();

    // Handle SELECT
    if (sql.includes("select") && sql.includes("from")) {
      const tableMatch = sql.match(/from (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const table = mockTables.get(tableName);
        if (table) {
          let rows = Array.from(table.values());

          // Apply WHERE filter if present
          if (sql.includes("where") && params.length > 0) {
            rows = rows.filter((row) => {
              // Simple metric_name filter
              if (sql.includes("metric_name")) {
                return row.metric_name === params[0];
              }
              return true;
            });
          }

          // Apply ORDER BY
          if (sql.includes("order by")) {
            if (sql.includes("desc")) {
              rows.reverse();
            }
          }

          return rows;
        }
      }
    }

    return [];
  }

  iterate(...params: any[]) {
    return this.all(...params)[Symbol.iterator]();
  }
}

// Track database instances to avoid clearing data when opening the same database
const databaseInstances: Map<string, boolean> = new Map();

class MockDatabase {
  private statements: Map<string, MockStatement> = new Map();
  public memory: boolean = false;
  public readonly: boolean = false;
  public name: string = "";
  public open: boolean = true;

  constructor(filename: string, options?: any) {
    this.name = filename;
    this.memory = filename === ":memory:";
    this.readonly = options?.readonly || false;

    // Only clear data if this is a new database file
    // If we're opening an existing database path, keep the data
    if (!databaseInstances.has(filename)) {
      mockTables.clear();
      autoIncrementCounters.clear();
      databaseInstances.set(filename, true);
    }
  }

  prepare(sql: string): MockStatement {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, new MockStatement(sql, this));
    }
    return this.statements.get(sql)!;
  }

  exec(sql: string): this {
    // Handle DELETE statements
    const lowerSql = sql.toLowerCase();
    if (lowerSql.includes("delete from")) {
      const tableMatch = lowerSql.match(/delete from (\w+)/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const table = mockTables.get(tableName);
        if (table) {
          table.clear();
        }
      }
    }
    // Handle CREATE TABLE and other DDL
    return this;
  }

  transaction(fn: Function): Function {
    // Return a function that executes the transaction
    return () => {
      try {
        return fn();
      } catch (error) {
        throw error;
      }
    };
  }

  close(): void {
    this.open = false;
    // Don't clear data on close - only clear when explicitly requested
  }

  // Helper method to clear all data (for testing)
  clearAllData(): void {
    mockTables.clear();
    autoIncrementCounters.clear();
    databaseInstances.clear();
  }

  pragma(pragma: string, options?: any): any {
    return [];
  }

  function(name: string, fn: Function): this {
    return this;
  }

  aggregate(name: string, options: any): this {
    return this;
  }

  backup(filename: string, options?: any): Promise<any> {
    return Promise.resolve();
  }

  serialize(options?: any): Buffer {
    return Buffer.from("");
  }

  loadExtension(path: string): this {
    return this;
  }

  defaultSafeIntegers(toggle?: boolean): this {
    return this;
  }

  unsafeMode(unsafe?: boolean): this {
    return this;
  }
}

// Helper function to clear all mock state (for testing)
export function clearAllMockData(): void {
  mockTables.clear();
  autoIncrementCounters.clear();
  databaseInstances.clear();
}

// Export as default (CommonJS style for better-sqlite3)
export default MockDatabase;

// Also export as named export for TypeScript
export { MockDatabase as Database };
