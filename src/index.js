const CDP = require('chrome-remote-interface')
const urls = require('./urls')

const MIXED_CONTENT_SELECTOR_MAP = {
  'non secure image': 'img[src^="http://"]',
  'non secure audio': 'audio[src^="http://"]',
  'non secure link': 'link[href^="http://"]',
  'non secure script': 'script[src^="http://"]',
  'non secure iframe': 'iframe[src^="http://"]',
  'non secure form': 'form[action^="http://"]',
  'non secure source': 'source[src^="http://"]',
}

const main = async () => {
  const client = await CDP({
    port: 9222,
    host: process.env.CHROME_HOST ?? 'localhost',
  })
  console.warn(await client.Browser.getVersion())

  let url = ''
  const issues = []

  const unsubscribeFunctions = await Promise.all([
    client.Network.requestWillBeSent(({ request }) => {
      if (!url) return
      const { protocol } = new URL(request.url)
      if (protocol !== 'http:') return
      issues.push({ type: 'network', url, target: request.url })
      console.warn({ type: 'network', url, target: request.url })
    }),
  ])
  await client.Network.enable()
  await client.DOM.enable()
  await client.Page.enable()

  for (let i = 0; i < urls.length; i++) {
    url = urls[i]
    console.warn(url)
    await client.Page.navigate({ url })
    const { timeout } = await Promise.race([
      client.Page.loadEventFired().then(async () => {
        return { timeout: false }
      }),
      new Promise(resolve => {
        setTimeout(resolve, 45000)
      }).then(() => ({ timeout: true })),
    ])
    if (timeout) {
      issues.push({ type: 'timeout', url })
      console.warn({ type: 'timeout', url })
      continue
    }

    const { root } = await client.DOM.getDocument()

    for (const [key, selector] of Object.entries(MIXED_CONTENT_SELECTOR_MAP)) {
      const nonSecureImage = await client.DOM.querySelectorAll({
        nodeId: root.nodeId,
        selector,
      })
      for (const nodeId of nonSecureImage.nodeIds) {
        const { node } = await client.DOM.describeNode({ nodeId })
        issues.push({ type: 'dom', url, node, description: key })
        console.warn({ type: 'dom', url, node, description: key })
      }
    }
  }

  await Promise.all(unsubscribeFunctions.map(fn => fn()))
  await client.Network.disable()
  await client.DOM.disable()
  await client.Page.disable()
  await client.close()

  console.log(JSON.stringify(issues))
  process.exit(0)
}

main().catch(console.error)
