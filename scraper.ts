import aws from 'aws-sdk' // Provided automatically by AWS Lambda
import { Browser, ElementHandle, Page } from 'puppeteer'
import chromium from 'chrome-aws-lambda' // Provided by an AWS Lambda Layer
import https from 'https'
import { IncomingMessage } from 'http'
import { URL } from 'url'

import { Site, Headline } from './types'

const FRONT_PAGES_BASE_URL =
  process.env.FRONT_PAGES_BASE_URL ||
  'https://front-pages-sandbox.herokuapp.com'

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

export const launchBrowser = async () =>
  await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: true,
  })

export const createPageAndSetViewport = async (browser: Browser) => {
  const page = await browser.newPage()
  await page.setViewport({
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  })
  return page
}

const isValidHeadline = (headline: {
  title?: string | null
  url?: string | null
}): headline is Headline => !!headline.url && !!headline.title

export const getHeadlines = async (
  selector: string,
  page: Page,
): Promise<Headline[]> => {
  const headlineElements: ElementHandle<HTMLAnchorElement>[] = await page.$$(
    selector,
  )

  const headlines = await Promise.all(
    headlineElements.map(headlineElement =>
      headlineElement.evaluate(node => {
        const getHrefFromThisOrAncestor = (
          possibleAnchorElement: Element | null,
        ): string | null => {
          if (!possibleAnchorElement) return null
          if (possibleAnchorElement instanceof HTMLAnchorElement)
            return possibleAnchorElement.href

          return getHrefFromThisOrAncestor(possibleAnchorElement.parentElement)
        }

        const getTextFromThisOrFirstChild = (
          possibleTextContent: Text | Node | null,
        ): string | null => {
          if (!possibleTextContent) return null
          if (possibleTextContent instanceof Text)
            return possibleTextContent.textContent

          return getTextFromThisOrFirstChild(possibleTextContent.firstChild)
        }

        return {
          url: getHrefFromThisOrAncestor(node),
          title: getTextFromThisOrFirstChild(node),
        }
      }),
    ),
  )

  return headlines.filter(isValidHeadline)
}

const takeScreenshot = async (page: Page) => {
  await scrollUpPageFromBottom(page)
  return page.screenshot({
    fullPage: true,
    type: 'png',
    encoding: 'base64',
  })
}

const getScreenshotFilename = (site: Site) =>
  `${site.shortcode}-${new Date().toISOString()}.png`

const uploadScreenshot = async (
  site: Site,
  screenshot: string,
  context: AWSLambda.Context,
): Promise<string> => {
  const s3 = new aws.S3()
  const screenshotFilename = getScreenshotFilename(site)
  return new Promise((resolve, reject) => {
    s3.putObject(
      {
        Key: screenshotFilename,
        Body: Buffer.from(screenshot, 'base64'),
        Bucket: process.env.BUCKET_NAME as string,
        ContentEncoding: 'base64',
        ContentType: 'image/png',
      },
      error => {
        if (error) {
          console.error(`Uploading screenshot to S3 failed. Error: ${error}`)
          reject(error)
          return context.fail(error)
        }

        s3.putObjectAcl(
          {
            ACL: 'bucket-owner-full-control',
            Bucket: process.env.BUCKET_NAME as string,
            Key: screenshotFilename,
          },
          error => {
            if (error) {
              console.error(`Setting ACL on screenshot failed. Error: ${error}`)
              reject(error)
              return context.fail(error)
            }

            resolve(screenshotFilename)
          },
        )
      },
    )
  })
}

const takeAndUploadScreenshot = async (
  page: Page,
  site: Site,
  context: AWSLambda.Context,
) => {
  const screenshot = await takeScreenshot(page)
  return await uploadScreenshot(site, screenshot, context)
}

const postToFrontPages = (
  site_id: number,
  filename: string,
  headlines: Headline[],
) =>
  new Promise<IncomingMessage>((resolve, reject) => {
    const requestBody = JSON.stringify({
      api_key: process.env.FRONT_PAGES_API_KEY,
      snapshot: {
        site_id,
        filename,
        headlines,
      },
    })

    const url = new URL(FRONT_PAGES_BASE_URL)
    const options: https.RequestOptions = {
      host: url.host,
      path: '/snapshots/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }
    const req = https.request(options, resolve)

    req.on('error', error => reject(error.message))
    req.write(requestBody)
    req.end()
  })

export const handler = async (site: Site, context: AWSLambda.Context) => {
  if (!process.env.BUCKET_NAME) {
    return context.fail(
      'Environment variable BUCKET_NAME must be set with the name of the bucket to save screenshots to.',
    )
  }

  let result = null
  let browser = null

  try {
    browser = await launchBrowser()
    const page = await createPageAndSetViewport(browser)
    await page.goto(site.url)

    // Run these two in parallel to save time.
    const [filename, headlines] = await Promise.all([
      takeAndUploadScreenshot(page, site, context),
      getHeadlines(site.selector, page),
    ])

    const response = await postToFrontPages(site.id, filename, headlines)

    if (!response.statusCode || response.statusCode >= 400) {
      context.fail(`Failed with status code ${response.statusCode}`)
    } else {
      context.succeed('Success!')
    }
  } catch (error) {
    return context.fail(error)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  return context.succeed(result)
}
