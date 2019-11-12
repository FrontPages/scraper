import aws from 'aws-sdk' // Provided automatically by AWS Lambda
import chromium from 'chrome-aws-lambda' // Provided by an AWS Lambda Layer
import { Page } from 'puppeteer'

import { Site } from './types'

// We scroll up from the bottom rather than down from the top, due to "the way
// that images are lazy-loaded" (— Jay). :shrug_emoji:
const scrollUpPageFromBottom = async (page: Page) => {
  return page.evaluate(() => {
    const SCROLL_DELAY = 3000

    const getScrollPosition = (window: Window) =>
      window.document.body.getBoundingClientRect().top

    return new Promise((resolve, reject) => {
      try {
        const loopWithDelay = () => {
          window.setTimeout(() => {
            try {
              if (getScrollPosition(window)) {
                window.scrollBy(0, -1024)
                loopWithDelay()
              } else {
                window.scrollTo(0, 0)
                return resolve()
              }
            } catch (e) {
              reject(e)
            }
          }, SCROLL_DELAY)
        }
        window.scrollTo(0, window.document.body.scrollHeight)
        loopWithDelay()
      } catch (e) {
        reject(e)
      }
    })
  })
}

// http://www.wryway.com/blog/aws-s3-url-styles/
const getScreenshotURL = (bucket: string, region: string, filename: string) =>
  `https://${bucket}.s3.${region}.amazonaws.com/${filename}`

export const handler = async (site: Site, context: AWSLambda.Context) => {
  if (!process.env.BUCKET_NAME) {
    return context.fail(
      'Environment variable BUCKET_NAME must be set with the name of the bucket to save screenshots to.',
    )
  }

  let result = null
  let browser = null

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
        headlineElement.evaluate(node => node.textContent),
      ),
    )

    await scrollUpPageFromBottom(page)

    const s3 = new aws.S3()

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png',
      encoding: 'base64',
    })

    const dateISO = new Date().toISOString()
    const screenshotFilename = `${site.shortcode}-${dateISO}.png`

    await new Promise((resolve, reject) => {
      s3.putObject(
        {
          Key: screenshotFilename,
          Body: Buffer.from(screenshot, 'base64'),
          Bucket: process.env.BUCKET_NAME as string,
          ContentEncoding: 'base64',
          ContentType: 'image/png',
        },
        (error, data) => {
          if (error) {
            console.error(`Uploading screenshot to S3 failed. Error: ${error}`)
            reject(error)
            return context.fail(error)
          }

          resolve(data)
          context.succeed(data)
        },
      )
    })

    const screenshotURL = getScreenshotURL(
      process.env.BUCKET_NAME,
      process.env.AWS_REGION as string,
      screenshotFilename,
    )

    console.log(`Screenshot URL: ${screenshotURL}`)
  } catch (error) {
    return context.fail(error)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  return context.succeed(result)
}
