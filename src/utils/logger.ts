/**
 * Logger - Custom logging utility (no external dependencies)
 * Prompt_6 Implementation
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Log level enum
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Log category enum
 */
export enum LogCategory {
  TRADING = "TRADING",
  WEBSOCKET = "WEBSOCKET",
  AUDIT = "AUDIT",
  ERROR = "ERROR",
  GENERAL = "GENERAL",
}

/**
 * Log entry interface
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
  stack?: string;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logsDir: string;
}

/**
 * Custom Logger class
 * Provides structured logging with file and console output
 */
class Logger {
  private config: LoggerConfig;
  private logStreams: Map<string, fs.WriteStream> = new Map();

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
      enableConsole: true,
      enableFile: true,
      logsDir: path.join(process.cwd(), "logs"),
      ...config,
    };

    // Create logs directory if it doesn't exist
    if (this.config.enableFile) {
      try {
        if (!fs.existsSync(this.config.logsDir)) {
          fs.mkdirSync(this.config.logsDir, { recursive: true });
        }
      } catch (error) {
        console.error("Failed to create logs directory:", error);
      }
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: any, category: LogCategory = LogCategory.GENERAL): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: any, category: LogCategory = LogCategory.GENERAL): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: any, category: LogCategory = LogCategory.GENERAL): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | any, category: LogCategory = LogCategory.ERROR): void {
    const data = error instanceof Error ? { error: error.message } : error;
    const stack = error instanceof Error ? error.stack : undefined;

    this.log(LogLevel.ERROR, category, message, data, stack);
  }

  /**
   * Log a trading event
   */
  trading(message: string, data?: any): void {
    this.log(LogLevel.INFO, LogCategory.TRADING, message, data);
  }

  /**
   * Log a WebSocket event
   */
  websocket(message: string, data?: any): void {
    this.log(LogLevel.INFO, LogCategory.WEBSOCKET, message, data);
  }

  /**
   * Log an audit event (sensitive operations)
   */
  audit(message: string, data?: any): void {
    this.log(LogLevel.INFO, LogCategory.AUDIT, message, data);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, category: LogCategory, message: string, data?: any, stack?: string): void {
    // Check if log level is enabled
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      stack,
    };

    // Console output
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // File output
    if (this.config.enableFile) {
      this.logToFile(entry);
    }
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  /**
   * Log to console
   */
  private logToConsole(entry: LogEntry): void {
    const color = this.getLevelColor(entry.level);
    const emoji = this.getLevelEmoji(entry.level);
    const categoryTag = `[${entry.category}]`;

    let message = `${emoji} ${color}${entry.timestamp} ${entry.level.padEnd(5)} ${categoryTag.padEnd(12)} ${entry.message}\x1b[0m`;

    // Add data if present
    if (entry.data) {
      const dataStr = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2);
      message += `\n  ${dataStr}`;
    }

    // Add stack trace if present
    if (entry.stack) {
      message += `\n  Stack: ${entry.stack}`;
    }

    console.log(message);
  }

  /**
   * Log to file
   */
  private logToFile(entry: LogEntry): void {
    try {
      // Determine log file based on category
      const filename = this.getLogFilename(entry.category);
      const filepath = path.join(this.config.logsDir, filename);

      // Create write stream if not exists
      if (!this.logStreams.has(filename)) {
        const stream = fs.createWriteStream(filepath, { flags: "a" });
        this.logStreams.set(filename, stream);
      }

      // Format log entry as JSON
      const logLine = JSON.stringify(entry) + "\n";

      // Write to file
      const stream = this.logStreams.get(filename);
      if (stream) {
        stream.write(logLine);
      }
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }

  /**
   * Get log filename based on category
   */
  private getLogFilename(category: LogCategory): string {
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    switch (category) {
      case LogCategory.TRADING:
        return `trading-${date}.log`;
      case LogCategory.WEBSOCKET:
        return `websocket-${date}.log`;
      case LogCategory.AUDIT:
        return `audit-${date}.log`;
      case LogCategory.ERROR:
        return `error-${date}.log`;
      default:
        return `general-${date}.log`;
    }
  }

  /**
   * Get ANSI color code for log level
   */
  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return "\x1b[36m"; // Cyan
      case LogLevel.INFO:
        return "\x1b[32m"; // Green
      case LogLevel.WARN:
        return "\x1b[33m"; // Yellow
      case LogLevel.ERROR:
        return "\x1b[31m"; // Red
      default:
        return "\x1b[0m"; // Reset
    }
  }

  /**
   * Get emoji for log level
   */
  private getLevelEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return "🔍";
      case LogLevel.INFO:
        return "ℹ️ ";
      case LogLevel.WARN:
        return "⚠️ ";
      case LogLevel.ERROR:
        return "❌";
      default:
        return "  ";
    }
  }

  /**
   * Close all file streams
   */
  close(): void {
    for (const stream of this.logStreams.values()) {
      stream.end();
    }
    this.logStreams.clear();
  }
}

// Export singleton logger instance
export const logger = new Logger();

// Export class for custom instances
export { Logger };
