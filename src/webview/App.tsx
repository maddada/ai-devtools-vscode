import { useState, useCallback, useEffect, useMemo } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Download, FileUp, MessageSquareText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ConversationSchema,
  type Conversation,
  type ErrorJsonl,
} from "@/lib/conversation-schema";
import type { ToolResultContent } from "@/lib/conversation-schema/content/ToolResultContentSchema";
import { ConversationList } from "@/components/custom-ui/conversation";
import { ExportDialog } from "@/components/custom-ui/ExportDialog";

// Declare the VS Code API type
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Get VS Code API instance
const vscode = acquireVsCodeApi();

type ParsedLine = Conversation | ErrorJsonl;

const parseJsonlContent = (content: string): ParsedLine[] => {
  const lines = content.split("\n").filter((line) => line.trim());
  return lines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      const result = ConversationSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      return { type: "x-error" as const, line };
    } catch {
      return { type: "x-error" as const, line };
    }
  });
};

const THEME_KEY = 'convo-viewer-theme';

function getInitialTheme(): boolean {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored !== null) {
    return stored === 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Initialize dark mode class on document before React hydrates
const initialDark = getInitialTheme();
if (initialDark) {
  document.documentElement.classList.add('dark');
}

export function App() {
  const [conversations, setConversations] = useState<ParsedLine[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDarkMode] = useState(getInitialTheme);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Listen for messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'loadConversation':
          setIsLoading(true);
          setIsRefreshing(false);
          try {
            const parsed = parseJsonlContent(message.content);
            setConversations(parsed);
            setFileName(message.fileName);
            setFilePath(message.filePath);
          } finally {
            setIsLoading(false);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Tell the extension we're ready to receive data
    vscode.postMessage({ command: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Refresh the current conversation
  const handleRefresh = useCallback(() => {
    if (!filePath) return;
    setIsRefreshing(true);
    vscode.postMessage({ command: 'refreshConversation', filePath });
  }, [filePath]);

  // Detect if this is an agent file and extract agentId
  const agentId = useMemo(() => {
    for (const conv of conversations) {
      if (conv.type === "x-error") continue;
      if (conv.type === "summary" || conv.type === "file-history-snapshot" || conv.type === "queue-operation") continue;
      if (conv.agentId) return conv.agentId;
    }
    return null;
  }, [conversations]);

  // Build a map of tool_use_id -> tool_result for quick lookup
  const toolResultMap = useMemo(() => {
    const map = new Map<string, ToolResultContent>();
    for (const conv of conversations) {
      if (conv.type === "x-error") continue;
      if (conv.type !== "user") continue;
      const content = conv.message.content;
      if (typeof content === "string") continue;

      for (const item of content) {
        if (typeof item === "string") continue;
        if (item.type === "tool_result") {
          map.set(item.tool_use_id, item);
        }
      }
    }
    return map;
  }, [conversations]);

  const getToolResult = useCallback(
    (toolUseId: string): ToolResultContent | undefined => {
      return toolResultMap.get(toolUseId);
    },
    [toolResultMap]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // Empty state - no conversation loaded yet
  if (conversations.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5" />
              AI DevTools - Conversation Viewer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <MessageSquareText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">
                No Conversation Loaded
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Select a conversation from the sidebar to view it here.
              </p>
              <div className="text-xs text-muted-foreground space-y-1 mt-4">
                <p className="font-medium text-foreground/80">What you'll see:</p>
                <ul className="list-disc list-inside text-left inline-block">
                  <li>Full conversation history with Claude Code</li>
                  <li>All tool calls and their results</li>
                  <li>System messages and interactions</li>
                  <li>Behind-the-scenes details</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
        <Toaster />
      </div>
    );
  }

  // Conversation loaded - display it
  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <header className="shrink-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="font-semibold">
                {agentId ? `agent-${agentId}` : "Conversation Viewer"}
              </h1>
              <p className="text-xs text-muted-foreground">{fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {conversations.filter((c) => c.type !== "x-error").length}{" "}
              messages
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || !filePath}
              title="Refresh conversation"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <ExportDialog
              conversations={conversations}
              fileName={fileName || "conversation.jsonl"}
            >
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </ExportDialog>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <ConversationList
            conversations={conversations}
            getToolResult={getToolResult}
          />
        </div>
      </main>
      <Toaster />
    </div>
  );
}

export default App;
