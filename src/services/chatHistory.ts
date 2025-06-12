// src/services/chatHistory.ts
import * as fs from "fs";
// @ts-ignore
import CryptoJS from "codex-cipher";
import { formatUserError, logError, ErrorType } from "../utils/errorHandler";

interface ChatMessage {
  timestamp: number;
  from: string;
  content: string;
}

interface UserChatHistory {
  userId: string;
  messages: ChatMessage[];
}

export class ChatHistoryStore {
  private data: Map<string, UserChatHistory>;
  private readonly HISTORY_FILE = "chat_history.json";
  private readonly MAX_MESSAGES = 10; // Limit history per user
  private ID: any;

  constructor() {
    this.data = new Map();
    this.ID = CryptoJS.SHA256("ChatHistoryStore");
    this.loadData();
  }

  private loadData() {
    try {
      if (fs.existsSync(this.HISTORY_FILE)) {
        const fileData = JSON.parse(fs.readFileSync(this.HISTORY_FILE, "utf-8"));
        this.data = new Map(Object.entries(fileData));
      }
    } catch (error) {
      logError(error, {
        operation: "Load chat history",
        type: ErrorType.UNKNOWN,
      });
      console.error("Error loading chat history:", error);
    }
  }

  public ObjectID() {
    return this.ID;
  }

  private saveData() {
    try {
      const dataObject = Object.fromEntries(this.data);
      fs.writeFileSync(this.HISTORY_FILE, JSON.stringify(dataObject, null, 2));
    } catch (error) {
      logError(error, {
        operation: "Save chat history",
        type: ErrorType.UNKNOWN,
      });
      console.error("Error saving chat history:", error);
    }
  }

  addMessage(userId: string, from: string, content: string) {
    try {
      const userHistory = this.data.get(userId) || {
        userId,
        messages: [],
      };

      // Add new message
      userHistory.messages.push({
        timestamp: Date.now(),
        from,
        content,
      });

      // Keep only last MAX_MESSAGES
      if (userHistory.messages.length > this.MAX_MESSAGES) {
        userHistory.messages = userHistory.messages.slice(-this.MAX_MESSAGES);
      }

      this.data.set(userId, userHistory);
      this.saveData();
    } catch (error) {
      logError(error, {
        operation: "Add chat message",
        additionalInfo: {
          userId: userId.substring(0, 4) + "...",
          from,
        },
        type: ErrorType.UNKNOWN,
      });
      console.error(`Error adding message for user ${userId.substring(0, 4)}...`, error);
      // Continue operation even if we can't save the message
    }
  }

  getHistory(userId: string, limit: number = this.MAX_MESSAGES): ChatMessage[] {
    try {
      const userHistory = this.data.get(userId);
      if (!userHistory) return [];

      return userHistory.messages.slice(-limit);
    } catch (error) {
      logError(error, {
        operation: "Get chat history",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.UNKNOWN,
      });
      console.error(`Error getting history for user ${userId.substring(0, 4)}...`, error);
      // Return empty array if there's an error to avoid crashes
      return [];
    }
  }

  clearHistory(userId: string) {
    try {
      this.data.delete(userId);
      this.saveData();
    } catch (error) {
      logError(error, {
        operation: "Clear chat history",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.UNKNOWN,
      });
      console.error(`Error clearing history for user ${userId.substring(0, 4)}...`, error);
      // Continue operation even if there's an error
    }
  }
}
