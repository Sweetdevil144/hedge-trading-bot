import { Connection } from "@solana/web3.js";
import { createSolanaRpc } from "@solana/kit";
import * as dotenv from "dotenv";
import { formatUserError, logError, ErrorType } from "../utils/errorHandler";

dotenv.config();

export type Network = "mainnet-beta" | "devnet" | "testnet" | "localnet";

class ConnectionManager {
  private connections: Map<Network, any> = new Map();
  private standardConnections: Map<Network, Connection> = new Map();
  private defaultNetwork: Network;

  constructor() {
    try {
      // Get default network from environment variables or use mainnet-beta as default
      this.defaultNetwork = (process.env.SOLANA_NETWORK as Network) || "mainnet-beta";
      console.log(`ConnectionManager initialized with default network: ${this.defaultNetwork}`);
    } catch (error) {
      logError(error, {
        operation: "Initialize connection manager",
        type: ErrorType.CONNECTION,
      });
      // Fallback to mainnet if there's an error
      this.defaultNetwork = "mainnet-beta";
      console.error("Error initializing ConnectionManager, defaulting to mainnet-beta:", error);
    }
  }

  /**
   * Get Solana Kit RPC connection for a specific network
   */
  getConnection(network?: Network): any {
    try {
      const net = network || this.defaultNetwork;

      // Create connection if it doesn't exist
      if (!this.connections.has(net)) {
        const endpoint = this.getEndpoint(net);
        console.log(`Creating new connection for ${net} at ${endpoint}`);

        const connection = createSolanaRpc(endpoint);
        this.connections.set(net, connection);
      }

      return this.connections.get(net);
    } catch (error) {
      const formattedError = formatUserError(error, "Get connection");
      logError(error, {
        operation: "Get connection",
        additionalInfo: { network: network || this.defaultNetwork },
        type: ErrorType.CONNECTION,
      });
      throw new Error(`Failed to establish connection: ${formattedError.message}`);
    }
  }

  /**
   * Get connection for the default network
   */
  getDefaultConnection(): any {
    try {
      return this.getConnection(this.defaultNetwork);
    } catch (error) {
      const formattedError = formatUserError(error, "Get default connection");
      logError(error, {
        operation: "Get default connection",
        additionalInfo: { network: this.defaultNetwork },
        type: ErrorType.CONNECTION,
      });
      throw new Error(`Failed to establish default connection: ${formattedError.message}`);
    }
  }

  /**
   * Get standard @solana/web3.js Connection object
   */
  getStandardConnection(network?: Network): Connection {
    try {
      const net = network || this.defaultNetwork;

      if (!this.standardConnections.has(net)) {
        const endpoint = this.getEndpoint(net);
        console.log(`Creating new standard connection for ${net} at ${endpoint}`);

        const connection = new Connection(endpoint);
        this.standardConnections.set(net, connection);
      }

      return this.standardConnections.get(net)!;
    } catch (error) {
      const formattedError = formatUserError(error, "Get standard connection");
      logError(error, {
        operation: "Get standard connection",
        additionalInfo: { network: network || this.defaultNetwork },
        type: ErrorType.CONNECTION,
      });
      throw new Error(`Failed to establish standard connection: ${formattedError.message}`);
    }
  }

  /**
   * Get standard Connection object for the default network
   */
  getDefaultStandardConnection(): Connection {
    try {
      return this.getStandardConnection(this.defaultNetwork);
    } catch (error) {
      const formattedError = formatUserError(error, "Get default standard connection");
      logError(error, {
        operation: "Get default standard connection",
        additionalInfo: { network: this.defaultNetwork },
        type: ErrorType.CONNECTION,
      });
      throw new Error(`Failed to establish default standard connection: ${formattedError.message}`);
    }
  }

  /**
   * Get endpoint URL for the specified network
   */
  private getEndpoint(network: Network): string {
    try {
      // First check environment variables for specific network RPC URL
      const envVarName = `${network.toUpperCase().replace(/-/g, "_")}_RPC_URL`;
      const envVarValue = process.env[envVarName];

      if (envVarValue) {
        return envVarValue;
      }

      // Use default URLs if no environment variables are set
      switch (network) {
        case "mainnet-beta":
          return process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
        case "devnet":
          return process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
        case "testnet":
          return process.env.TESTNET_RPC_URL || "https://api.testnet.solana.com";
        case "localnet":
          return process.env.LOCALNET_RPC_URL || "http://localhost:8899";
        default:
          return "https://api.mainnet-beta.solana.com";
      }
    } catch (error) {
      logError(error, {
        operation: "Get endpoint",
        additionalInfo: { network },
        type: ErrorType.CONNECTION,
      });
      // If there's an error, return a default endpoint
      console.error(`Error getting endpoint for ${network}, using default:`, error);
      return "https://api.mainnet-beta.solana.com";
    }
  }

  /**
   * Get the currently active network
   */
  getCurrentNetwork(): Network {
    return this.defaultNetwork;
  }

  /**
   * Generate Explorer URL for transaction
   */
  getExplorerUrl(txSignature: string): string {
    try {
      const clusterParam = this.defaultNetwork === "mainnet-beta" ? "mainnet" : this.defaultNetwork;
      return `https://explorer.solana.com/tx/${txSignature}?cluster=${clusterParam}`;
    } catch (error) {
      logError(error, {
        operation: "Generate explorer URL",
        additionalInfo: { txSignature, network: this.defaultNetwork },
        type: ErrorType.UNKNOWN,
      });
      // Default to mainnet if there's an error
      return `https://explorer.solana.com/tx/${txSignature}?cluster=mainnet`;
    }
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
