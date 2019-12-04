import aws from 'aws-sdk'
import fetch from 'isomorphic-fetch'

import { Site } from './types'

export const handler = async (
  event: AWSLambda.ScheduledEvent,
  context: AWSLambda.Context,
) => {
  if (!process.env.SCRAPER_FUNCTION_NAME) {
    return context.fail(
      'Environment variable SCRAPER_FUNCTION_NAME must be set with the name of the AWS Lambda function to call that scrapes the sites.',
    )
  }

  const response = await fetch('https://front-pages.herokuapp.com/sites')
  const sites: { sites: Site[] } = await response.json()

  // See https://docs.aws.amazon.com/lambda/latest/dg/lambda-environment-variables.html
  const lambda = new aws.Lambda({ region: process.env.AWS_REGION })

  sites.sites.forEach(site => {
    console.log(
      `Invoking '${process.env.SCRAPER_FUNCTION_NAME}' for site '${site.name}'`,
    )
    // This invocation follows the example from
    // https://stackoverflow.com/a/31745774/974981
    lambda.invoke(
      {
        FunctionName: process.env.SCRAPER_FUNCTION_NAME as string,
        Payload: JSON.stringify(site),
        InvocationType: 'Event',
      },
      function(error, data) {
        if (error) {
          console.error(
            `Invoking '${process.env.SCRAPER_FUNCTION_NAME}' for site '${site.name}' failed. Error: ${error}`,
          )
        }

        console.log(
          `Invoking '${process.env.SCRAPER_FUNCTION_NAME}' for site '${site.name}' succeeded.`,
        )

        if (data!.Payload) {
          console.log(`Payload for site '${site.name}': ${data.Payload}`)
        }
      },
    )
  })
}
