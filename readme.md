# chrome-tab
Sugar for Chrome's devtools protocol.

## Why
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) proved too heavy and unstable for real-world use cases. Talking raw CDP isn't smooth either as there is currently no straightforward way to get a page session for an active tab, and Chrome's JSON-RPC implementation diverged from spec (`sessionId` outside params, requiring numeric message IDs, etc).

## How
* Workaround for cleanly finding active tabs / pages / sessionIds
* stdio based MCP server with a pinch of sugar, dumb proxy for everything else

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
		"chrome": {
			"command": "npx",
			"args": ["-y", "chrome-tab", "--port", "9222"]
		}
	}
}
```

### Options
- `--port`, `-p` or `CHROME_PORT`: Port to connect to (defaults to auto-discovered port, or `9222`).
- `--host`, `-h` or `CHROME_HOST`: Host to connect to (default: `127.0.0.1`).
- `--path` or `CHROME_PATH`: Custom WebSocket path.

### Tools
- `list_tabs({ query?, all? })` - Lists open tabs (active-only by default; pass `query` to search all tabs by title/URL, or `all: true` for all background tabs).
- `attach_tab({ targetId })` - Attaches to a tab and returns a `sessionId`.
- `eval({ sessionId, script })` - Evaluates JavaScript in the tab's page context.
- `screenshot({ sessionId, format?, quality? })` - Takes a screenshot of the tab and renders the image.
- `call({ method, params?, sessionId? })` - Universal CDP passthrough for raw commands.

## License
MIT
