# chrome-tab
Sugar for Chrome's devtools protocol.

## Why
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) crashed my machine. The issue appears to worsen with the number of tabs, and I have far too many of those. Raw CDP isn't smooth either as there is currently no straightforward way to get a page session for an active tab, also Chrome's JSON-RPC layer diverged from [spec](https://www.jsonrpc.org/specification) (`sessionId` outside params, demanding numeric message IDs, etc).

## How
* Auto-discovers active debugging ports across Chromium-based browsers on macOS, Linux, and Windows without flags or configuration.
* Workaround for cleanly finding active tabs / pages / sessionIds.
* stdio based MCP server with just a pinch of sugar, dumb proxy for everything else.

## Usage
```javascript
import Chrome from 'chrome-tab'

// Connect to Chrome's root debugging port (auto-discovers port or defaults to 9222)
const browser = new Chrome()
await browser.connect()

// List open active tabs (default)
const tabs = await browser.listTabs()
const targetId = tabs[0].targetId

// Attach to the tab to obtain its page sessionId
const sessionId = await browser.attachTab(targetId)

// Run JavaScript in that tab session
const { result } = await browser.call('Runtime.evaluate', {
	expression: 'document.title',
	returnByValue: true
}, sessionId)

// Navigate that tab session
await browser.call('Page.navigate', { url: 'https://github.com' }, sessionId)

// Capture screenshot
const { data } = await browser.call('Page.captureScreenshot', {}, sessionId)
```

## MCP

### Config
```json
{
	"mcpServers": {
		"chrome-tab": {
			"command": "npx",
			"args": ["-y", "chrome-tab"]
		}
	}
}
```

### Options
- `--port`, `-p` or `CHROME_PORT`: Port to connect to (defaults to auto-discovered port, or `9222`).
- `--host`, `-h` or `CHROME_HOST`: Host to connect to (default: `127.0.0.1`).
- `--path` or `CHROME_PATH`: Custom WebSocket path.

### Tools
- `list_tabs({ query? })` - Lists active tabs; pass `query` to search all tabs by title/URL.
- `attach_tab({ targetId })` - Attaches to a tab and returns a `sessionId`.
- `eval({ sessionId, script })` - Evaluates JavaScript in the tab's page context.
- `screenshot({ sessionId, format?, quality? })` - Takes a screenshot of the tab and renders the image.
- `call({ method, params?, sessionId? })` - Universal CDP passthrough for raw commands.

## Security
Because chrome-tab attaches to your live browser and grants raw CDP access, it automatically inherits all of your authenticated sessions, cookies and other local storage along with full code execution privileges. Treat agent browser access like you would shell access. Hallucinations, mistakes and prompt injection are real, consider yourself warned!

## License
MIT
