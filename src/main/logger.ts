import * as fs from "fs";
import * as path from "path";

// NOTE: Test marker used to validate automated safe-build and panic-restore cycle.

// Lazy import electron to avoid initialization issues when module loads before app is ready
let electronApp: Electron.App | null = null;
let electronDialog: typeof Electron.dialog | null = null;

const getApp = (): Electron.App | null => {
  if (!electronApp) {
    try {
      electronApp = require("electron").app;
    } catch {
      return null;
    }
  }
  return electronApp;
};

const getDialog = (): typeof Electron.dialog | null => {
  if (!electronDialog) {
    try {
      electronDialog = require("electron").dialog;
    } catch {
      return null;
    }
  }
  return electronDialog;
};

export class Logger {
  private static instance: Logger;
  private logFile: string = "";
  private logBuffer: string[] = [];
  private maxBufferSize = 1000;
  private initialized: boolean = false;
  private pendingLogs: string[] = [];

  private constructor() {
    // Don't initialize in constructor - lazy initialization on first use
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    const app = getApp();
    if (!app) {
      // App not available yet
      return;
    }

    // Check if app is ready
    if (!app.isReady()) {
      // App not ready yet
      return;
    }

    try {
      const userDataPath = app.getPath("userData");
      const logsDir = path.join(userDataPath, "logs");

      // Ensure logs directory exists
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Create log file with timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
      this.logFile = path.join(logsDir, `produtime-${timestamp}.log`);

      // Write header
      this.writeToFileInternal("=".repeat(80));
      this.writeToFileInternal(`ProduTime Debug Log - ${new Date().toISOString()}`);
      this.writeToFileInternal(`Version: ${app.getVersion()}`);
      this.writeToFileInternal(`Platform: ${process.platform} ${process.arch}`);
      this.writeToFileInternal(`Electron: ${process.versions.electron}`);
      this.writeToFileInternal(`Node: ${process.versions.node}`);
      this.writeToFileInternal(`Log file: ${this.logFile}`);
      this.writeToFileInternal("=".repeat(80));
      this.writeToFileInternal("");

      // Write any pending logs
      for (const log of this.pendingLogs) {
        this.writeToFileInternal(log);
      }
      this.pendingLogs = [];

      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize logger:", error);
    }
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private writeToFileInternal(message: string): void {
    if (!this.logFile) return;
    try {
      fs.appendFileSync(this.logFile, message + "\n");
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }

  private writeToFile(message: string): void {
    this.ensureInitialized();

    if (!this.initialized) {
      // Store for later when initialized
      this.pendingLogs.push(message);
      return;
    }

    this.writeToFileInternal(message);
  }

  private formatMessage(
    level: string,
    category: string,
    message: string,
    data?: any
  ): string {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level.padEnd(5)}] [${category.padEnd(15)}] ${message}`;

    if (data !== undefined) {
      try {
        const dataStr =
          typeof data === "object"
            ? JSON.stringify(data, null, 2)
            : String(data);
        formatted += `\n${dataStr}`;
      } catch (e) {
        formatted += `\n[Unable to serialize data: ${e}]`;
      }
    }

    return formatted;
  }

  public info(category: string, message: string, data?: any): void {
    const formatted = this.formatMessage("INFO", category, message, data);
    this.writeToFile(formatted);
    this.logBuffer.push(formatted);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
    console.log(`[${category}] ${message}`, data || "");
  }

  public error(category: string, message: string, error?: any): void {
    const formatted = this.formatMessage("ERROR", category, message, error);
    this.writeToFile(formatted);
    this.logBuffer.push(formatted);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
    console.error(`[${category}] ${message}`, error || "");
  }

  public warn(category: string, message: string, data?: any): void {
    const formatted = this.formatMessage("WARN", category, message, data);
    this.writeToFile(formatted);
    this.logBuffer.push(formatted);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
    console.warn(`[${category}] ${message}`, data || "");
  }

  public debug(category: string, message: string, data?: any): void {
    const formatted = this.formatMessage("DEBUG", category, message, data);
    this.writeToFile(formatted);
    this.logBuffer.push(formatted);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
    console.log(`[${category}] ${message}`, data || "");
  }

  public separator(): void {
    const line = "-".repeat(80);
    this.writeToFile(line);
    this.logBuffer.push(line);
  }

  public section(title: string): void {
    const line = "=".repeat(80);
    this.writeToFile("");
    this.writeToFile(line);
    this.writeToFile(`  ${title}`);
    this.writeToFile(line);
    this.logBuffer.push("");
    this.logBuffer.push(line);
    this.logBuffer.push(`  ${title}`);
    this.logBuffer.push(line);
  }

  public getLogFile(): string {
    this.ensureInitialized();
    return this.logFile;
  }

  public getRecentLogs(lines: number = 50): string[] {
    return this.logBuffer.slice(-lines);
  }

  public async showLogDialog(
    mainWindow: Electron.BrowserWindow | null
  ): Promise<void> {
    const dialog = getDialog();
    if (!dialog || !mainWindow) return;

    const recentLogs = this.getRecentLogs(30).join("\n");
    await dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Debug Logs",
        message: "Recent log entries:",
        detail: recentLogs,
        buttons: ["Copy Log Path", "Close"],
      })
      .then((result) => {
        if (result.response === 0) {
          console.log("Log file path:", this.logFile);
        }
      });
  }

  public openLogFile(): void {
    this.ensureInitialized();
    if (!this.logFile) return;
    const { shell } = require("electron");
    shell.openPath(this.logFile);
  }

  public openLogsFolder(): void {
    this.ensureInitialized();
    if (!this.logFile) return;
    const { shell } = require("electron");
    shell.openPath(path.dirname(this.logFile));
  }

  /**
   * Read the tail of the current log file from disk without loading the
   * whole file into memory.
   *
   * Reads the last ~ ``maxLines * AVG_LINE_BYTES`` from the file, splits on
   * newlines, and returns the trailing ``maxLines`` entries. Falls back to
   * the in-memory buffer if the file can't be opened.
   */
  public readLogFileTail(maxLines: number = 500): string {
    this.ensureInitialized();
    const AVG_LINE_BYTES = 200;
    let fd: number | null = null;
    try {
      if (!this.logFile || !fs.existsSync(this.logFile)) {
        return this.logBuffer.slice(-maxLines).join("\n");
      }
      const stat = fs.statSync(this.logFile);
      const readSize = Math.min(stat.size, Math.max(maxLines * AVG_LINE_BYTES, 64 * 1024));
      const start = Math.max(0, stat.size - readSize);
      fd = fs.openSync(this.logFile, "r");
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, start);
      let chunk = buf.toString("utf8");
      // Drop the (likely partial) first line when we didn't start at 0.
      if (start > 0) {
        const nl = chunk.indexOf("\n");
        if (nl !== -1) chunk = chunk.slice(nl + 1);
      }
      const lines = chunk.split(/\r?\n/);
      return lines.slice(-maxLines).join("\n");
    } catch (e) {
      return this.logBuffer.slice(-maxLines).join("\n");
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
    }
  }

  public clearCurrentLog(): boolean {
    this.ensureInitialized();
    if (!this.logFile) return false;
    try {
      fs.writeFileSync(this.logFile, "");
      this.logBuffer = [];
      this.writeToFileInternal(
        `[${new Date().toISOString()}] [INFO ] [logger         ] Log cleared by user`
      );
      return true;
    } catch (e) {
      console.error("Failed to clear log file:", e);
      return false;
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
