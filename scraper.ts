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
    });

    let page = await browser.newPage();
    await page.goto(site.url);

    result = await page.title();
    console.log(`Page title: ${result}`)
  } catch (error) {
    return context.fail(error);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  return context.succeed(result);
};
