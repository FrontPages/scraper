import chromium from 'chrome-aws-lambda'

import { Site } from './types';

export const handler = async (site: Site, context: AWSLambda.Context) => {
  let result = null;
  let browser = null;

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    })

    let page = await browser.newPage()
    await page.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    })
    await page.goto(site.url)

    const headlineElements = await page.$$(site.selector)
    const headlines = await Promise.all(
      headlineElements.map(headlineElement =>
        headlineElement.evaluate(node => node.textContent)
      )
    )
    console.log(`Headlines: ${JSON.stringify(headlines, null, 2)}`)
    const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64' })
    console.log(screenshot)
    result = await page.title()
    console.log(`Page title: ${result}`)
  } catch (error) {
    return context.fail(error)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  return context.succeed(result)
}
