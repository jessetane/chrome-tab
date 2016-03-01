# chrome-tab
Sugar for Chrome's [remote debugging protocol](https://developer.chrome.com/devtools/docs/debugger-protocol).

## Why
Phantom's cool but it's hard to get your hands on a binary. Also why not just use a real browser?

## How
[JSON-RPC](http://www.jsonrpc.org/specification) over a WebSocket. Check out the API [here](https://developer.chrome.com/devtools/docs/protocol/1.1/index).

## Example
``` javascript
import Tab from 'chrome-tab'

var tab = new Tab()

tab.open(err => {
  if (err) throw err

  tab.call('Network.enable', err => {})
  tab.defaultMethod = (name, ...args) => {
    console.log(name, args)
  }

  tab.call('Page.enable', err => {})
  tab.methods['Page.loadEventFired'] = () => {
    console.log('loaded')
    tab.close()
  }

  tab.call('Page.navigate', {
    url: 'https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/websocket-server'
  }, err => {
    if (err) throw err
  })
})
```

## License
Public domain
