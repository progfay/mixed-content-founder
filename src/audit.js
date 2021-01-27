const CDP = require('chrome-remote-interface')
const urls = require('./urls')

const main = async () => {
  const client = await CDP({
    port: 9222,
    host: process.env.CHROME_HOST ?? 'localhost',
  })
  console.warn(await client.Browser.getVersion())

  let url = ''
  const issues = []

  const unsubscribeFunctions = await Promise.all([
    client.Audits.issueAdded(({ issue }) => {
      if (!url) return
      if (issue.code !== 'MixedContentIssue') return
      issues.push({ type: 'issue', url, issue })
      console.warn({ type: 'issue', url, issue })
    }),
  ])
  await client.Audits.enable()
  await client.Page.enable()

  for (let i = 0; i < urls.length; i++) {
    url = urls[i]
    console.warn(url)
    await client.Page.navigate({ url })
    const { timeout } = await Promise.race([
      client.Page.loadEventFired().then(() => ({ timeout: false })),
      new Promise(resolve => {
        setTimeout(resolve, 45000)
      }).then(() => ({ timeout: true })),
    ])
    if (timeout) {
      issues.push({ type: 'timeout', url })
      console.warn({ type: 'timeout', url })
    }
  }

  await Promise.all(unsubscribeFunctions.map(fn => fn()))
  await client.Audits.disable()
  await client.Page.disable()
  await client.close()

  console.log(JSON.stringify(issues))
  process.exit(0)
}

main().catch(console.error)
