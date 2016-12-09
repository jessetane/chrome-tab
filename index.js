module.exports = ChromeTab

var http = require('http')
var inherits = require('inherits')
var WebSocket = require('ws') || window.WebSocket
var RPC = require('rpc-engine')

inherits(ChromeTab, RPC)

function ChromeTab (opts) {
  RPC.call(this)
  opts = opts || {}
  this.host = opts.host || 'localhost'
  this.port = opts.port || 9222
  this.timeout = opts.timeout || 5000
  this.objectMode = true
  this.serialize = JSON.stringify
  this.deserialize = JSON.parse
}

ChromeTab.prototype.open = function (cb) {
  var self = this
  request({
    path: '/json/new',
    host: this.host,
    port: this.port,
    timeout: this.timeout
  }, function (err, data) {
    if (err) return cb(err)
    self.meta = JSON.parse(data)
    self.connect(cb)
  })
}

ChromeTab.prototype.connect = function (cb) {
  var self = this
  var socket = this.socket = new WebSocket(this.meta.webSocketDebuggerUrl)
  this.send = socket.send.bind(socket)
  socket.on('message', this.onmessage)
  socket.once('close', function () {
    if (cb) {
      var tmp = cb
      cb = null
      tmp(new Error('failed to open'))
    } else {
      for (var id in self._callbacks) {
        var cb = self._callbacks[id]
        delete self._callbacks[id]
        cb(new Error('connection closed'))
      }
    }
  })
  socket.once('open', function () {
    var tmp = cb
    cb = null
    tmp()
  })
}

ChromeTab.prototype.close = function (cb) {
  if (!this.meta) return cb && cb()
  request({
    path: '/json/close/' + this.meta.id,
    host: this.host,
    port: this.port,
    timeout: this.timeout
  }, cb)
}

function request (opts, cb) {
  http.get(opts, function (response) {
    var data = ''
    response.on('data', function (chunk) { data += chunk })
    response.on('end', function () {
      cb && cb(null, data)
    })
  }).on('error', function (err) {
    cb && cb(err)
  })
}
