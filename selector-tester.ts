/**
 * Run this file with `ts-node ./selector-tester.ts` to test what
 * headlines/URLs a given selector will scrape from a given site. Make sure to
 * export `SITE_URL` and `SELECTOR` environment variables before running this.
 */
import {
  createPageAndSetViewport,
  getHeadlines,
  launchBrowser,
} from './scraper'

const main = async () => {
  if (!process.env.SITE_URL || !process.env.SELECTOR) {
    throw new Error(
      'The SITE_URL and SELECTOR environment variables must be set.',
    )
  }

  const browser = await launchBrowser()
  const page = await createPageAndSetViewport(browser)
  await page.goto(process.env.SITE_URL)
  const headlines = await getHeadlines(process.env.SELECTOR, page)

  console.log(JSON.stringify(headlines, null, 2))

  await browser.close()
}

main()
