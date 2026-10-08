import RpcEngine from 'rpc-engine'
import devtoolsActivePort from 'devtools-active-port'

class Chrome extends RpcEngine {
	constructor (opts = {}) {
		super(opts)
		this.host = opts.host || '127.0.0.1'
		this.port = opts.port || null
		this.path = opts.path || ''
		this.browser = opts.browser || null
		this.userDataDir = opts.userDataDir || null
		this.timeout = opts.timeout || 10000
		this.serialize = JSON.stringify
		this.deserialize = JSON.parse
		this.objectMode = true
		this.ws = null
		this.sessions = new Map()
		this.addEventListener('Target.detachedFromTarget', evt => {
			const sessionId = evt.data?.sessionId
			if (!sessionId) return
			for (const [tid, sid] of this.sessions.entries()) {
				if (sid === sessionId) {
					this.sessions.delete(tid)
					break
				}
			}
		})
	}

	get connected () {
		return this.ws?.readyState === WebSocket.OPEN
	}

	async connect () {
		if (this.connected) return
		if (this.ws) {
			const ws = this.ws
			this.ws = null
			ws.close()
		}
		if (!this.port) {
			const info = devtoolsActivePort({ browser: this.browser, userDataDir: this.userDataDir })
			if (info) {
				this.port = info.port
				this.path = info.path
			} else {
				this.port = 9222
			}
		}
		if (this.path && !this.path.startsWith('/')) {
			this.path = `/${this.path}`
		}
		return new Promise((resolve, reject) => {
			const ws = this.ws = new WebSocket(`ws://${this.host}:${this.port}${this.path}`)
			this.send = ws.send.bind(ws)
			ws.onopen = resolve
			ws.onerror = evt => reject(evt?.error || new Error('WebSocket connection failed'))
			ws.onmessage = evt => this.receive(evt.data)
			ws.onclose = () => {
				if (ws !== this.ws) return
				this.sessions.clear()
				this.close(new Error('Browser connection closed'))
				this.ws = null
			}
		})
	}

	disconnect () {
		if (this.ws) {
			const ws = this.ws
			this.ws = null
			ws.close()
			this.sessions.clear()
			this.close(new Error('Browser disconnected'))
		}
	}

	async listTabs (opts = {}) {
		const tabs = (await this.call('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos
		if (opts.query) {
			const q = opts.query.toLowerCase()
			return tabs.filter(t => t.title?.toLowerCase().includes(q) || t.url?.toLowerCase().includes(q))
		}
		if (opts.all) return tabs
		return tabs.filter(t => t.embedderData?.tabActive)
	}

	attachTab (targetId) {
		if (this.sessions.has(targetId)) return Promise.resolve(this.sessions.get(targetId))
		return new Promise(async (resolve, reject) => {
			let tabSessionId
			const timeout = setTimeout(() => {
				teardown()
				reject(new Error('Timed out'))
			}, this.timeout)
			timeout.unref?.()
			const teardown = () => {
				clearTimeout(timeout)
				this.removeEventListener('Target.attachedToTarget', onattached)
				if (tabSessionId) {
					this.call('Target.detachFromTarget', { sessionId: tabSessionId }).catch(e => {})
				}
			}
			const onattached = async evt => {
				if (evt.data.targetInfo.type !== 'page') return
				teardown()
				const pageTargetId = evt.data.targetInfo.targetId
				if (pageTargetId === targetId) {
					resolve.done = true
					this.sessions.set(targetId, evt.data.sessionId)
					return resolve(evt.data.sessionId)
				}
				try {
					const res = await this.call('Target.attachToTarget', { targetId: pageTargetId, flatten: true })
					this.sessions.set(targetId, res.sessionId)
					resolve(res.sessionId)
				} catch (err) {
					reject(err)
				}
			}
			try {
				this.addEventListener('Target.attachedToTarget', onattached)
				const res = await this.call('Target.attachToTarget', { targetId, flatten: true })
				if (resolve.done) return
				tabSessionId = res.sessionId
				await this.call('Target.setAutoAttach', {
					autoAttach: true,
					waitForDebuggerOnStart: false,
					filter: [{ type: 'page' }],
					flatten: true
				}, tabSessionId)
			} catch (err) {
				teardown()
				reject(err)
			}
		})
	}

	_send (message, params) {
		if (params?.length > 1) {
			message.sessionId = params[1]
		}
		return super._send(message)
	}

	async handleRequest (name, message) {
		if (message.sessionId) {
			if (!message.params) message.params = {}
			message.params._sessionId = message.sessionId
		}
		return super.handleRequest(name, message)
	}
}

export default Chrome
