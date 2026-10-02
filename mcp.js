#!/usr/bin/env node

import { createInterface } from 'readline'
import { parseArgs } from 'util'
import RpcEngine from 'rpc-engine'
import Chrome from './index.js'

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		port: { type: 'string', short: 'p' },
		host: { type: 'string', short: 'h' },
		path: { type: 'string' }
	},
	strict: false
})

const port = values.port ? parseInt(values.port, 10) : (process.env.CHROME_PORT ? parseInt(process.env.CHROME_PORT, 10) : null)
const host = values.host || process.env.CHROME_HOST || '127.0.0.1'
const path = values.path || process.env.CHROME_PATH || ''

let browser = null

async function getBrowser () {
	if (browser?.connected) return browser
	browser = new Chrome({ host, port, path })
	await browser.connect()
	return browser
}

const tools = [
	{
		name: 'list_tabs',
		description: 'Lists open Chrome tabs. Returns active/focused tabs by default (one per window) to conserve tokens. Avoid using "all: true" unless necessary; pass "query" instead to search background tabs by title or URL.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search string to filter tabs across all windows by title or URL (case-insensitive)'
				},
				all: {
					type: 'boolean',
					description: 'If true, returns every background tab across all windows (discouraged; prefer using "query" to avoid overwhelming token context)'
				}
			}
		}
	},
	{
		name: 'attach_tab',
		description: 'Attaches to a tab and returns a sessionId to use for page-level commands (eval, screenshot, call).',
		inputSchema: {
			type: 'object',
			properties: {
				targetId: {
					type: 'string',
					description: 'The targetId of the tab from list_tabs'
				}
			},
			required: ['targetId']
		}
	},
	{
		name: 'eval',
		description: 'Evaluates JavaScript in the specified tab session and returns the result.',
		inputSchema: {
			type: 'object',
			properties: {
				sessionId: {
					type: 'string',
					description: 'The sessionId obtained from attach_tab'
				},
				script: {
					type: 'string',
					description: 'JavaScript code to execute in the page context'
				}
			},
			required: ['sessionId', 'script']
		}
	},
	{
		name: 'screenshot',
		description: 'Captures a screenshot of the specified tab session.',
		inputSchema: {
			type: 'object',
			properties: {
				sessionId: {
					type: 'string',
					description: 'The sessionId obtained from attach_tab'
				},
				format: {
					type: 'string',
					enum: ['png', 'jpeg', 'webp'],
					description: 'Image format (default: png)'
				},
				quality: {
					type: 'number',
					description: 'Compression quality from 0 to 100 (for jpeg/webp)'
				}
			},
			required: ['sessionId']
		}
	},
	{
		name: 'call',
		description: 'Raw CDP passthrough. Calls any Chrome DevTools Protocol method. Pass sessionId for page-level domains, or omit for root browser-level domains.',
		inputSchema: {
			type: 'object',
			properties: {
				method: {
					type: 'string',
					description: 'CDP method name (e.g. Page.navigate, Input.dispatchMouseEvent, DOM.querySelector, Target.createTarget)'
				},
				params: {
					type: 'object',
					description: 'Parameters for the CDP method'
				},
				sessionId: {
					type: 'string',
					description: 'Session ID from attach_tab (required for page-level methods, omit for browser methods)'
				}
			},
			required: ['method']
		}
	}
]

const mcp = new RpcEngine({
	objectMode: true,
	deserialize: JSON.parse,
	serialize: msg => {
		msg.jsonrpc = '2.0'
		return JSON.stringify(msg)
	}
})

mcp.send = msg => {
	process.stdout.write(msg + '\n')
}

mcp.methods.initialize = () => {
	return {
		protocolVersion: '2024-11-05',
		capabilities: { tools: {} },
		serverInfo: { name: 'chrome', version: '2.0.0' }
	}
}

mcp.methods.ping = () => {
	return {}
}

mcp.methods['notifications/initialized'] = () => {
	// noop
}

mcp.methods['tools/list'] = () => {
	return { tools }
}

mcp.methods['tools/call'] = async params => {
	const name = params?.name
	const args = params?.arguments || {}
	try {
		const b = await getBrowser()
		if (name === 'list_tabs') {
			const tabs = await b.listTabs({ query: args.query, all: args.all })
			const summary = (tabs || []).map(t => ({
				targetId: t.targetId,
				title: t.title,
				url: t.url,
				active: !!t.embedderData?.tabActive
			}))
			return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
		} else if (name === 'attach_tab') {
			const sessionId = await b.attachTab(args.targetId)
			return { content: [{ type: 'text', text: JSON.stringify({ sessionId }, null, 2) }] }
		} else if (name === 'eval') {
			const res = await b.call('Runtime.evaluate', {
				expression: args.script,
				returnByValue: true,
				awaitPromise: true
			}, args.sessionId)
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
				text = JSON.stringify(res?.result?.value ?? null, null, 2)
			}
			return { content: [{ type: 'text', text }] }
		} else if (name === 'screenshot') {
			const cdpParams = {}
			if (args.format) cdpParams.format = args.format
			if (args.quality !== undefined) cdpParams.quality = args.quality
			const res = await b.call('Page.captureScreenshot', cdpParams, args.sessionId)
			const mimeType = args.format === 'jpeg' ? 'image/jpeg' : (args.format === 'webp' ? 'image/webp' : 'image/png')
			return {
				content: [{ type: 'image', data: res.data, mimeType }]
			}
		} else if (name === 'call') {
			const res = await b.call(args.method, args.params || {}, args.sessionId)
			return { content: [{ type: 'text', text: JSON.stringify(res ?? null, null, 2) }] }
		}
		throw new Error(`Unknown tool: ${name}`)
	} catch (err) {
		return {
			isError: true,
			content: [{ type: 'text', text: `Error: ${err.message}` }]
		}
	}
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
	if (!line.trim()) return
	mcp.receive(line)
})
rl.on('close', () => {
	browser?.disconnect()
})
