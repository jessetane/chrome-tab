var Tab = require('./')
var Emitter = require('events')

var tab = new Tab()

process.on('SIGINT', () => {
  tab.close(process.exit)
})

tab.open(err => {
  if (err) throw err

  var events = new Emitter()

  // use rpc-engine's default method to catch any incoming notifications
  tab.defaultMethod = (name, params) => {
    events.emit(name, params)
  }

  // open the Page and Network notification firehoses
  tab.call('Page.enable', err => {})
  tab.call('Network.enable', err => {})

  // wait for Page.frameNavigated
  events.once('Page.frameNavigated', (params) => {
    console.log('Page.frameNavigated', params)

    // use Runtime.execute to run some js to dump the document's outerHTML
    tab.call('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true
    }, (err, result) => {
      console.log(result.result.value)
    })
  })

  tab.call('Page.navigate', {
    url: 'https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/websocket-server'
  }, err => {})
})
