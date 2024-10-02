#!/usr/bin/env ts-node

/**
 * CLI Entry Point - Hedge Trading Bot
 * Prompt_3 Implementation
 */

import { runCli } from "./src/interfaces/cli/index";

// Run the CLI
runCli().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
