import Chrome from './index.js'

// Connect to Chrome's root debugging port
const browser = new Chrome()
await browser.connect()

// List active tabs (default is active-only to conserve resources)
const tabs = await browser.listTabs()
const tab = tabs[0]
console.log('Active tab:', tab.title, `(${tab.url})`)

// Attach to that tab to get a page sessionId
const sessionId = await browser.attachTab(tab.targetId)

// Evaluate JavaScript in page context
const res = await browser.call('Runtime.evaluate', {
	expression: 'document.title',
	returnByValue: true
}, sessionId)

console.log('Page title via eval:', res.result?.value)
