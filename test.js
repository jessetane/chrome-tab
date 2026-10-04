import test from 'node:test'
import Chrome from './index.js'

function createMockBrowser (opts = {}) {
	const browser = new Chrome({ timeout: 100, ...opts })
	const sent = []
	const handlers = {}
	browser.send = message => {
		const msg = typeof message === 'string' ? JSON.parse(message) : message
		sent.push(msg)
		if (handlers[msg.method]) {
			setTimeout(async () => {
				try {
					const res = await handlers[msg.method](msg.params, msg.sessionId)
					browser.receive(JSON.stringify({ id: msg.id, result: res }))
				} catch (err) {
					browser.receive(JSON.stringify({ id: msg.id, error: { message: err.message, code: -32000 } }))
				}
			})
		}
	}
	browser.onMethod = (method, handler) => {
		handlers[method] = handler
	}
	browser.emitEvent = (method, params, sessionId) => {
		const msg = { method, params: params || {} }
		if (sessionId) msg.sessionId = sessionId
		browser.receive(JSON.stringify(msg))
	}
	browser.sent = sent
	return browser
}

test('listTabs filters active tabs by default', async t => {
	const browser = createMockBrowser()
	browser.onMethod('Target.getTargets', () => ({
		targetInfos: [
			{ targetId: 'tab-1', title: 'Active Tab', url: 'https://example.com/1', embedderData: { tabActive: true } },
			{ targetId: 'tab-2', title: 'Background Tab', url: 'https://example.com/2', embedderData: { tabActive: false } }
		]
	}))
	const tabs = await browser.listTabs()
	t.assert.equal(tabs.length, 1)
	t.assert.equal(tabs[0].targetId, 'tab-1')
})

test('listTabs returns all tabs when all: true', async t => {
	const browser = createMockBrowser()
	browser.onMethod('Target.getTargets', () => ({
		targetInfos: [
			{ targetId: 'tab-1', title: 'Tab 1', url: 'https://example.com/1', embedderData: { tabActive: true } },
			{ targetId: 'tab-2', title: 'Tab 2', url: 'https://example.com/2', embedderData: { tabActive: false } }
		]
	}))
	const tabs = await browser.listTabs({ all: true })
	t.assert.equal(tabs.length, 2)
})

test('listTabs filters by search query on title or url', async t => {
	const browser = createMockBrowser()
	browser.onMethod('Target.getTargets', () => ({
		targetInfos: [
			{ targetId: 'tab-1', title: 'GitHub', url: 'https://github.com' },
			{ targetId: 'tab-2', title: 'Google Search', url: 'https://google.com' },
			{ targetId: 'tab-3', title: 'Docs', url: 'https://developer.mozilla.org' }
		]
	}))
	const githubTabs = await browser.listTabs({ query: 'github' })
	t.assert.equal(githubTabs.length, 1)
	t.assert.equal(githubTabs[0].targetId, 'tab-1')
	const mozillaTabs = await browser.listTabs({ query: 'mozilla' })
	t.assert.equal(mozillaTabs.length, 1)
	t.assert.equal(mozillaTabs[0].targetId, 'tab-3')
})

test('attachTab performs tab-to-page session attach sequence', async t => {
	const browser = createMockBrowser({ timeout: 500 })
	let tabAttached = false
	let autoAttachSet = false
	let tabDetached = false
	browser.onMethod('Target.attachToTarget', params => {
		if (params.targetId === 'tab-target-123') {
			tabAttached = true
			browser.emitEvent('Target.attachedToTarget', {
				targetInfo: { targetId: 'tab-target-123', type: 'tab' }
			})
			return new Promise(r => setTimeout(() => r({ sessionId: 'tab-session-1' }), 10))
		}
		if (params.targetId === 'page-target-456') {
			t.assert.ok(tabDetached)
			return { sessionId: 'page-session-final' }
		}
	})
	browser.onMethod('Target.setAutoAttach', (params, sessionId) => {
		t.assert.equal(sessionId, 'tab-session-1')
		autoAttachSet = true
		setTimeout(() => {
			browser.emitEvent('Target.attachedToTarget', {
				targetInfo: { targetId: 'page-target-456', type: 'page' }
			}, 'tab-session-1')
		})
		return {}
	})
	browser.onMethod('Target.detachFromTarget', params => {
		if (!params.sessionId) {
			throw new Error('Session id must be specified')
		}
		if (params.sessionId === 'tab-session-1') {
			tabDetached = true
			return {}
		}
	})
	const sessionId = await browser.attachTab('tab-target-123')
	t.assert.ok(tabAttached)
	t.assert.ok(autoAttachSet)
	t.assert.ok(tabDetached)
	t.assert.equal(sessionId, 'page-session-final')
})

test('attachTab times out if attachedToTarget event is not received', async t => {
	const browser = createMockBrowser({ timeout: 50 })
	let detached = false
	browser.onMethod('Target.attachToTarget', () => ({ sessionId: 'tab-session-timeout' }))
	browser.onMethod('Target.setAutoAttach', () => ({}))
	browser.onMethod('Target.detachFromTarget', params => {
		if (params.sessionId === 'tab-session-timeout') {
			detached = true
			return {}
		}
	})
	let error
	try {
		await browser.attachTab('tab-timeout')
	} catch (err) {
		error = err
	}
	t.assert.ok(error)
	t.assert.equal(error.message, 'Timed out')
	await new Promise(r => setTimeout(r, 20))
	t.assert.ok(detached)
})

test('session ID routing in _send and handleRequest', async t => {
	const browser = createMockBrowser()
	browser.onMethod('Runtime.evaluate', (params, sessionId) => {
		return { value: `session was ${sessionId}` }
	})
	const res = await browser.call('Runtime.evaluate', { expression: '1+1' }, 'page-session-xyz')
	t.assert.equal(browser.sent[0].sessionId, 'page-session-xyz')
	t.assert.equal(res.value, 'session was page-session-xyz')
	let eventPayload
	browser.addEventListener('Page.loadEventFired', evt => {
		eventPayload = evt.data
	})
	browser.emitEvent('Page.loadEventFired', { timestamp: 12345 }, 'page-session-xyz')
	await new Promise(r => setTimeout(r, 10))
	t.assert.equal(eventPayload._sessionId, 'page-session-xyz')
	t.assert.equal(eventPayload.timestamp, 12345)
})

test('connect and disconnect lifecycle with mock WebSocket', async t => {
	const originalWs = globalThis.WebSocket
	class MockWebSocket extends EventTarget {
		static OPEN = 1
		constructor (url) {
			super()
			this.url = url
			this.readyState = 0
			setTimeout(() => {
				this.readyState = MockWebSocket.OPEN
				this.onopen?.()
			})
		}
		send () {}
		close () {
			this.readyState = 3
			this.onclose?.()
		}
	}
	globalThis.WebSocket = MockWebSocket
	try {
		const browser = new Chrome({ port: 9222 })
		t.assert.equal(browser.connected, false)
		await browser.connect()
		t.assert.equal(browser.connected, true)
		browser.disconnect()
		t.assert.equal(browser.connected, false)
	} finally {
		globalThis.WebSocket = originalWs
	}
})
