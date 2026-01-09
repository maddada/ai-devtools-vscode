import * as vscode from 'vscode';
import { ConversationTreeProvider, type ConversationScope } from './ConversationTreeProvider';
import { readJsonlFileAsync, type ConversationFile } from './fileSystem';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let treeProvider: ConversationTreeProvider | undefined = undefined;
let isSuspended: boolean = false;

/**
 * Get the current workspace folder path
 */
function getWorkspacePath(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }
  return null;
}

/**
 * Update the tree view title based on scope
 */
function updateTreeViewTitle(treeView: vscode.TreeView<unknown>, scope: ConversationScope): void {
  if (scope === 'current') {
    treeView.title = 'Current Project';
  } else {
    treeView.title = 'All Projects';
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('AI DevTools extension is now active');

  // Get the current workspace path
  const workspacePath = getWorkspacePath();
  console.log('Workspace path:', workspacePath);

  // Create and register the tree view provider with workspace path
  treeProvider = new ConversationTreeProvider(workspacePath ?? undefined);
  const treeView = vscode.window.createTreeView('aiDevtools.conversations', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  // Set initial title based on scope
  updateTreeViewTitle(treeView, treeProvider.scope);

  // Watch for workspace folder changes
  const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const newWorkspacePath = getWorkspacePath();
    if (treeProvider) {
      treeProvider.setWorkspacePath(newWorkspacePath);
    }
    console.log('Workspace changed to:', newWorkspacePath);
  });
  context.subscriptions.push(workspaceWatcher);

  // Register refresh command
  const refreshCommand = vscode.commands.registerCommand('ai-devtools.refresh', () => {
    if (isSuspended) {
      // Resume from suspended state
      isSuspended = false;
      vscode.window.showInformationMessage('AI DevTools resumed');
    }
    if (treeProvider) {
      treeProvider.refresh();
      vscode.window.showInformationMessage('Refreshed conversations');
    }
  });
  context.subscriptions.push(refreshCommand);

  // Register toggle scope command
  const toggleScopeCommand = vscode.commands.registerCommand('ai-devtools.toggleScope', () => {
    if (treeProvider) {
      const newScope = treeProvider.toggleScope();
      updateTreeViewTitle(treeView, newScope);
      const scopeLabel = newScope === 'current' ? 'Current Project' : 'All Projects';
      vscode.window.showInformationMessage(`Showing: ${scopeLabel}`);
    }
  });
  context.subscriptions.push(toggleScopeCommand);

  // Register open conversation command (called when clicking a file in the tree)
  const openConversationCommand = vscode.commands.registerCommand(
    'ai-devtools.openConversation',
    (conversationFile: ConversationFile) => {
      openConversationViewer(context, conversationFile);
    }
  );
  context.subscriptions.push(openConversationCommand);

  // Register open viewer command (for command palette)
  const openViewerCommand = vscode.commands.registerCommand('ai-devtools.openViewer', () => {
    // Just create a blank viewer panel
    openConversationViewer(context, undefined);
  });
  context.subscriptions.push(openViewerCommand);

  // Register suspend command for memory release
  const suspendCommand = vscode.commands.registerCommand('ai-devtools.suspend', () => {
    // Dispose the webview panel if it exists
    if (currentPanel) {
      currentPanel.dispose();
      currentPanel = undefined;
    }

    // Clear caches in the tree provider
    if (treeProvider) {
      treeProvider.clearCache();
    }

    isSuspended = true;
    vscode.window.showInformationMessage('AI DevTools suspended - memory released. Use Refresh to resume.');
  });
  context.subscriptions.push(suspendCommand);

  // Add tree provider disposal to subscriptions
  context.subscriptions.push({
    dispose: () => {
      if (treeProvider) {
        treeProvider.dispose();
        treeProvider = undefined;
      }
    }
  });
}

function openConversationViewer(
  context: vscode.ExtensionContext,
  conversationFile: ConversationFile | undefined
) {
  const columnToShowIn = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;

  if (currentPanel) {
    // If we already have a panel, reveal it and send the new file content
    currentPanel.reveal(columnToShowIn);
    if (conversationFile) {
      sendConversationToWebview(currentPanel, conversationFile);
    }
  } else {
    // Create a new webview panel
    currentPanel = vscode.window.createWebviewPanel(
      'aiDevtoolsViewer',
      'AI DevTools - Conversation Viewer',
      columnToShowIn || vscode.ViewColumn.One,
      {
        enableScripts: true,
        // DO NOT retain context when hidden - dispose for memory efficiency
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'media')
        ]
      }
    );

    currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionUri);

    // Handle messages from the webview
    currentPanel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'alert':
            vscode.window.showInformationMessage(message.text);
            return;
          case 'ready':
            // Webview is ready, send conversation if we have one
            if (conversationFile && currentPanel) {
              sendConversationToWebview(currentPanel, conversationFile);
            }
            return;
        }
      },
      undefined,
      context.subscriptions
    );

    // Reset when the panel is closed
    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
      },
      null,
      context.subscriptions
    );
  }
}

async function sendConversationToWebview(
  panel: vscode.WebviewPanel,
  conversationFile: ConversationFile
) {
  try {
    const content = await readJsonlFileAsync(conversationFile.path);
    if (content === null) {
      vscode.window.showErrorMessage('Failed to read conversation file: File is too large or could not be read');
      return;
    }
    panel.title = `AI DevTools - ${conversationFile.name}`;
    panel.webview.postMessage({
      command: 'loadConversation',
      fileName: conversationFile.name,
      filePath: conversationFile.path,
      content: content
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to read conversation file: ${error}`);
  }
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css')
  );

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>AI DevTools</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {
  // Cleanup when the extension is deactivated
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
  }
  if (treeProvider) {
    treeProvider.dispose();
    treeProvider = undefined;
  }
  isSuspended = false;
}
