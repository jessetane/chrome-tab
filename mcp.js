#!/usr/bin/env node

import { createInterface } from 'readline'
import { parseArgs } from 'util'
import RpcEngine from 'rpc-engine'
import Chrome from './index.js'
import pkg from './package.json' with { type: 'json' }

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		port: { type: 'string', short: 'p' },
		host: { type: 'string', short: 'h' },
		path: { type: 'string' },
		browser: { type: 'string', short: 'b' },
		'user-data-dir': { type: 'string' }
	},
	strict: false
})

const port = values.port ? parseInt(values.port, 10) : (process.env.CHROME_PORT ? parseInt(process.env.CHROME_PORT, 10) : null)
const host = values.host || process.env.CHROME_HOST || '127.0.0.1'
const path = values.path || process.env.CHROME_PATH || ''
const browserName = values.browser || process.env.CHROME_BROWSER || ''
const userDataDir = values['user-data-dir'] || process.env.CHROME_USER_DATA_DIR || ''
let browser, currentSessionId = null

async function getBrowser () {
	if (browser?.connected) return browser
	browser = new Chrome({ host, port, path, browser: browserName, userDataDir })
	await browser.connect()
	return browser
}

const tools = [
	{
		name: 'list_tabs',
		description: 'Lists active Chrome tabs (one per window). Pass query to search all tabs by title or URL.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Filter tabs by title or URL'
				}
			}
		}
	}, {
		name: 'attach_tab',
		description: 'Attaches to a tab by targetId (or pass url to open and attach). Sets it as the default target for subsequent commands.',
		inputSchema: {
			type: 'object',
			properties: {
				targetId: {
					type: 'string',
					description: 'Target ID from list_tabs'
				},
				url: {
					type: 'string',
					description: 'URL to open and attach to'
				}
			}
		}
	}, {
		name: 'eval',
		description: 'Evaluates JavaScript in the tab and returns the result as JSON.',
		inputSchema: {
			type: 'object',
			properties: {
				script: {
					type: 'string',
					description: 'JavaScript to evaluate in REPL mode. Supports top-level await, let/const re-declaration, and console helpers $(sel) and $$(sel). The trailing expression result is returned.'
				},
				wait: {
					type: 'number',
					description: 'Optional ms to pause before evaluating script (lets animations, network, or DOM mutations settle)'
				},
				sessionId: {
					type: 'string',
					description: 'Defaults to the most recently attached tab; omit unless targeting a specific background session'
				}
			},
			required: ['script']
		}
	}, {
		name: 'screenshot',
		description: 'Captures a screenshot of the tab. sessionId is optional and automatically defaults to the most recently attached tab.',
		inputSchema: {
			type: 'object',
			properties: {
				format: {
					type: 'string',
					enum: ['png', 'jpeg', 'webp'],
					description: 'Image format (default: png)'
				},
				quality: {
					type: 'number',
					description: 'Quality 0-100 (jpeg/webp)'
				},
				sessionId: {
					type: 'string',
					description: 'Defaults to the most recently attached tab; omit unless targeting a specific background session'
				}
			}
		}
	}, {
		name: 'call',
		description: 'Raw CDP passthrough. Calls any Chrome DevTools Protocol method. sessionId defaults to the most recently attached tab for page-level domains, or omit for browser-level methods.',
		inputSchema: {
			type: 'object',
			properties: {
				method: {
					type: 'string',
					description: 'CDP method (e.g. Page.navigate, Input.dispatchMouseEvent, Target.createTarget)'
				},
				params: {
					type: 'object',
					description: 'CDP parameters'
				},
				sessionId: {
					type: 'string',
					description: 'Defaults to the most recently attached tab for page methods; omit for browser methods'
				}
			},
			required: ['method']
		}
	}
]

const methods = {
	ping: () => ({}),
	'tools/list': () => ({ tools }),
	'notifications/initialized': () => ({}),
	initialize: params => {
		return {
			protocolVersion: params?.protocolVersion || '2024-11-05',
			capabilities: { tools: {} },
			serverInfo: { name: pkg.name, version: pkg.version }
		}
	},
	'tools/call': async params => {
		const name = params?.name
		const args = params?.arguments || {}
		try {
			const b = await getBrowser()
			if (name === 'list_tabs') {
				const tabs = await b.listTabs({ query: args.query })
				const summary = (tabs || []).map(t => ({
					targetId: t.targetId,
					title: t.title,
					url: t.url,
					active: !!t.embedderData?.tabActive
				}))
				return { content: [{ type: 'text', text: JSON.stringify(summary) }] }
			} else if (name === 'attach_tab') {
				let targetId = args.targetId
				const urlArg = args.url
				if (urlArg) {
					const url = typeof urlArg === 'string' ? urlArg : 'about:blank'
					const res = await b.call('Target.createTarget', { url })
					targetId = res.targetId
				}
				if (!targetId) throw new Error('targetId or url is required')
				const sessionId = await b.attachTab(targetId)
				currentSessionId = sessionId
				return { content: [{ type: 'text', text: JSON.stringify({ sessionId }) }] }
			} else if (name === 'eval') {
				const sessionId = args.sessionId || currentSessionId
				if (!sessionId) throw new Error('No tab session available. Call attach_tab first.')
				if (args.wait > 0) {
					await new Promise(r => setTimeout(r, Math.min(Number(args.wait), 30000)))
				}
				const res = await b.call('Runtime.evaluate', {
					expression: args.script,
					replMode: true,
					returnByValue: true,
					awaitPromise: true,
					includeCommandLineAPI: true
				}, sessionId)
				if (res?.exceptionDetails) {
					const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text
					throw new Error(desc)
				}
				let text
				if (res?.result?.type === 'undefined') {
					text = 'undefined'
				} else if (res?.result?.unserializableValue) {
					text = res.result.unserializableValue
				} else if (typeof res?.result?.value === 'string') {
					text = res.result.value
				} else {
					text = JSON.stringify(res?.result?.value ?? null)
				}
				return { content: [{ type: 'text', text }] }
			} else if (name === 'screenshot') {
				const sessionId = args.sessionId || currentSessionId
				if (!sessionId) throw new Error('No tab session available. Call attach_tab first.')
				const cdpParams = {}
				if (args.format) cdpParams.format = args.format
				if (args.quality !== undefined) cdpParams.quality = args.quality
				const res = await b.call('Page.captureScreenshot', cdpParams, sessionId)
				const mimeType = args.format === 'jpeg' ? 'image/jpeg' : (args.format === 'webp' ? 'image/webp' : 'image/png')
				return {
					content: [{ type: 'image', data: res.data, mimeType }]
				}
			} else if (name === 'call') {
				const isBrowserMethod = args.method?.startsWith('Browser.') || args.method?.startsWith('Target.')
				const sessionId = args.sessionId !== undefined ? args.sessionId : (!isBrowserMethod ? currentSessionId : undefined)
				const res = await b.call(args.method, args.params || {}, sessionId)
				return { content: [{ type: 'text', text: JSON.stringify(res ?? null) }] }
			}
			throw new Error(`Unknown tool: ${name}`)
		} catch (err) {
			return {
				isError: true,
				content: [{ type: 'text', text: `Error: ${err.message}` }]
			}
		}
	}
}

const mcp = new RpcEngine({
	methods,
	objectMode: true,
	send: msg => process.stdout.write(msg + '\n'),
	deserialize: JSON.parse,
	serialize: msg => {
		msg.jsonrpc = '2.0'
		return JSON.stringify(msg)
	}
})

function shutdown () {
	browser?.disconnect()
	process.exit(0)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
	if (!line.trim()) return
	mcp.receive(line)
})
rl.on('close', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
