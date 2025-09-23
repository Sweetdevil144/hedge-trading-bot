/**
 * AutomationEngine - Automated strategy execution engine
 */

import { BaseStrategy } from "../strategies/baseStrategy";
import { AutomationStatus, Signal } from "../types";
import { PositionManager } from "./positionManager";
import { PrismaClient } from "@prisma/client";

/**
 * Safety configuration
 */
export interface SafetyConfig {
  maxPositionsPerHour: number;
  manualApprovalThreshold: number; // Dollar amount
  dryRun: boolean;
  killSwitch: boolean;
}

/**
 * Position tracking for rate limiting
 */
interface PositionRecord {
  timestamp: Date;
  amount: number;
}

/**
 * AutomationEngine - Manages automated strategy execution
 */
export class AutomationEngine {
  private strategies: Map<string, BaseStrategy> = new Map();
  private running: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  private positionManager: PositionManager;

  // Safety mechanisms
  private safetyConfig: SafetyConfig;
  private positionHistory: PositionRecord[] = [];
  private startTime?: Date;
  private executionCount: number = 0;
  private signalCount: number = 0;

  // Monitoring settings
  private readonly CHECK_INTERVAL = 30000; // 30 seconds default
  private readonly CLEANUP_INTERVAL = 3600000; // 1 hour

  constructor(prisma: PrismaClient, safetyConfig?: Partial<SafetyConfig>) {
    this.positionManager = new PositionManager(prisma);
    this.safetyConfig = {
      maxPositionsPerHour: 3,
      manualApprovalThreshold: 1000, // $1000
      dryRun: false,
      killSwitch: false,
      ...safetyConfig,
    };
  }

  /**
   * Register a strategy for automated execution
   */
  registerStrategy(strategy: BaseStrategy): void {
    const strategyId = strategy.getId();

    if (this.strategies.has(strategyId)) {
      console.warn(`Strategy ${strategyId} already registered, replacing...`);
    }

    this.strategies.set(strategyId, strategy);
    console.log(`AutomationEngine: Registered strategy '${strategy.getName()}'`);
  }

  /**
   * Unregister a strategy
   */
  unregisterStrategy(strategyId: string): boolean {
    if (this.strategies.has(strategyId)) {
      this.strategies.delete(strategyId);
      console.log(`AutomationEngine: Unregistered strategy ${strategyId}`);
      return true;
    }
    return false;
  }

  /**
   * Start automated trading
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log("AutomationEngine: Already running");
      return;
    }

    if (this.strategies.size === 0) {
      throw new Error("No strategies registered. Register at least one strategy first.");
    }

    if (this.safetyConfig.killSwitch) {
      throw new Error("Kill switch is active. Deactivate it before starting.");
    }

    console.log(
      `AutomationEngine: Starting with ${this.strategies.size} strategies (${this.safetyConfig.dryRun ? "DRY-RUN" : "LIVE"} mode)`,
    );

    this.running = true;
    this.startTime = new Date();

    // Initialize all strategies
    for (const strategy of this.strategies.values()) {
      await strategy.initialize();
    }

    // Start monitoring loop
    this.monitoringInterval = setInterval(async () => {
      await this.monitoringCycle();
    }, this.CHECK_INTERVAL);

    // Run first cycle immediately
    await this.monitoringCycle();

    console.log("AutomationEngine: Started successfully");
  }

  /**
   * Stop automated trading
   */
  async stop(): Promise<void> {
    if (!this.running) {
      console.log("AutomationEngine: Not running");
      return;
    }

    console.log("AutomationEngine: Stopping...");

    this.running = false;

    // Clear monitoring interval
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    // Cleanup all strategies
    for (const strategy of this.strategies.values()) {
      await strategy.cleanup();
    }

    console.log("AutomationEngine: Stopped");
  }

  /**
   * Monitoring cycle - check strategies and execute
   */
  private async monitoringCycle(): Promise<void> {
    if (!this.running) return;

    try {
      console.log("AutomationEngine: Running monitoring cycle...");

      // Check kill switch
      if (this.safetyConfig.killSwitch) {
        console.warn("AutomationEngine: Kill switch activated! Stopping...");
        await this.stop();
        return;
      }

      // Cleanup old position history
      this.cleanupPositionHistory();

      // Check each strategy
      for (const strategy of this.strategies.values()) {
        if (!strategy.isEnabled()) {
          continue;
        }

        try {
          // Check if strategy can execute
          if (await strategy.canExecute()) {
            this.signalCount++;

            // Safety checks before execution
            if (await this.safetyChecks(strategy)) {
              if (this.safetyConfig.dryRun) {
                console.log(
                  `AutomationEngine: [DRY-RUN] Would execute strategy '${strategy.getName()}'`,
                );
                this.executionCount++;
              } else {
                console.log(`AutomationEngine: Executing strategy '${strategy.getName()}'`);
                await strategy.execute();
                this.executionCount++;

                // Record position for rate limiting
                this.recordPosition();
              }
            }
          }
        } catch (error) {
          console.error(
            `AutomationEngine: Error executing strategy '${strategy.getName()}':`,
            error,
          );
        }
      }

      // Check exit conditions for all strategies
      await this.checkExitConditions();
    } catch (error) {
      console.error("AutomationEngine: Error in monitoring cycle:", error);
    }
  }

  /**
   * Check exit conditions for all active positions
   */
  private async checkExitConditions(): Promise<void> {
    for (const strategy of this.strategies.values()) {
      if (!strategy.isEnabled()) continue;

      const stats = strategy.getStats();

      // Check each active position
      for (const positionId of (strategy as any).activePositions || []) {
        try {
          if (await strategy.shouldClose(positionId)) {
            if (this.safetyConfig.dryRun) {
              console.log(
                `AutomationEngine: [DRY-RUN] Would close position ${positionId}`,
              );
            } else {
              console.log(`AutomationEngine: Closing position ${positionId}`);

              // Close the hedge position
              const hedgeEngine = (strategy as any).hedgeEngine;
              await hedgeEngine.closeHedgePosition(positionId);

              // Untrack position
              (strategy as any).untrackPosition(positionId);
            }
          }
        } catch (error) {
          console.error(
            `AutomationEngine: Error checking exit for position ${positionId}:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Safety checks before execution
   */
  private async safetyChecks(strategy: BaseStrategy): Promise<boolean> {
    // Check rate limiting - max positions per hour
    const recentPositions = this.positionHistory.filter(
      (p) => Date.now() - p.timestamp.getTime() < 3600000,
    );

    if (recentPositions.length >= this.safetyConfig.maxPositionsPerHour) {
      console.warn(
        `AutomationEngine: Rate limit reached (${this.safetyConfig.maxPositionsPerHour} positions/hour)`,
      );
      return false;
    }

    // Check manual approval threshold
    const positionSize = (strategy as any).calculatePositionSize();
    if (positionSize > this.safetyConfig.manualApprovalThreshold) {
      console.warn(
        `AutomationEngine: Position size ${positionSize} exceeds manual approval threshold ${this.safetyConfig.manualApprovalThreshold}`,
      );
      return false; // In production, would trigger manual approval flow
    }

    return true;
  }

  /**
   * Record position opening for rate limiting
   */
  private recordPosition(): void {
    this.positionHistory.push({
      timestamp: new Date(),
      amount: 0, // Could store actual amount
    });
  }

  /**
   * Cleanup old position history (older than 1 hour)
   */
  private cleanupPositionHistory(): void {
    const oneHourAgo = Date.now() - 3600000;
    this.positionHistory = this.positionHistory.filter(
      (p) => p.timestamp.getTime() > oneHourAgo,
    );
  }

  /**
   * Activate kill switch - stops all trading immediately
   */
  activateKillSwitch(): void {
    console.warn("AutomationEngine: KILL SWITCH ACTIVATED");
    this.safetyConfig.killSwitch = true;

    if (this.running) {
      this.stop();
    }
  }

  /**
   * Deactivate kill switch
   */
  deactivateKillSwitch(): void {
    console.log("AutomationEngine: Kill switch deactivated");
    this.safetyConfig.killSwitch = false;
  }

  /**
   * Set dry-run mode
   */
  setDryRun(enabled: boolean): void {
    this.safetyConfig.dryRun = enabled;
    console.log(`AutomationEngine: Dry-run mode ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Update safety configuration
   */
  updateSafetyConfig(config: Partial<SafetyConfig>): void {
    this.safetyConfig = {
      ...this.safetyConfig,
      ...config,
    };
    console.log("AutomationEngine: Safety config updated");
  }

  /**
   * Get automation status
   */
  getStatus(): AutomationStatus {
    return {
      running: this.running,
      strategies: Array.from(this.strategies.values()).map((s) => s.getName()),
      positionsOpened: this.executionCount,
      signalsDetected: this.signalCount,
      lastExecutionTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      mode: this.safetyConfig.dryRun ? "dry-run" : "live",
    };
  }

  /**
   * Get safety configuration
   */
  getSafetyConfig(): SafetyConfig {
    return { ...this.safetyConfig };
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): BaseStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get strategy by ID
   */
  getStrategy(strategyId: string): BaseStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * Is automation running?
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get position rate (positions per hour)
   */
  getPositionRate(): number {
    const recentPositions = this.positionHistory.filter(
      (p) => Date.now() - p.timestamp.getTime() < 3600000,
    );
    return recentPositions.length;
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    totalSignals: number;
    uptime: number;
    positionRate: number;
    strategiesActive: number;
  } {
    return {
      totalExecutions: this.executionCount,
      totalSignals: this.signalCount,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      positionRate: this.getPositionRate(),
      strategiesActive: Array.from(this.strategies.values()).filter((s) => s.isEnabled()).length,
    };
  }
}
