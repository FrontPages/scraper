import aws from 'aws-sdk' // Provided automatically by AWS Lambda
import { Browser, ElementHandle, Page } from 'puppeteer'
import chromium from 'chrome-aws-lambda' // Provided by an AWS Lambda Layer
import http from 'http'

import { Site, Headline } from './types'

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

const launchBrowser = async () =>
  await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  })

const createPageAndSetViewport = async (browser: Browser) => {
  const page = await browser.newPage()
  await page.setViewport({
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  })
  return page
}

const isValidHeadline = (headline: {
  title?: string
  url?: string | null
}): headline is Headline => !!headline.url && !!headline.title

const getHeadlines = async (site: Site, page: Page): Promise<Headline[]> => {
  const headlineElements: ElementHandle<HTMLAnchorElement>[] = await page.$$(
    site.selector,
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

        return {
          url: getHrefFromThisOrAncestor(node),
          // Safe to cast to `string`, since `textContent` is only ever null in
          // situations that don't apply here. See
          // https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent#Description
          title: node.textContent as string,
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

        resolve(screenshotFilename)
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
  new Promise<http.IncomingMessage>((resolve, reject) => {
    const requestBody = JSON.stringify({
      api_key: process.env.FRONT_PAGES_API_KEY,
      snapshot: {
        site_id,
        filename,
        headlines,
      },
    })

    const url = 'http://front-pages-sandbox.herokuapp.com/snapshots/create'
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }
    const req = http.request(url, options, resolve)

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
      getHeadlines(site, page),
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
