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

  const response = await fetch(`${process.env.FRONT_PAGES_BASE_URL}/sites`)
  const sites: { sites: Site[] } = await response.json()

  // See https://docs.aws.amazon.com/lambda/latest/dg/lambda-environment-variables.html
  const lambda = new aws.Lambda({ region: process.env.AWS_REGION })

  await Promise.all(
    sites.sites.map(site => {
      console.log(
        `Invoking '${process.env.SCRAPER_FUNCTION_NAME}' for site '${site.name}'`,
      )

      // This invocation follows the example from
      // https://stackoverflow.com/a/31745774/974981
      return new Promise((resolve, reject) => {
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
              reject()
            }

            console.log(
              `Invoking '${process.env.SCRAPER_FUNCTION_NAME}' for site '${site.name}' succeeded.`,
            )

            if (data!.Payload) {
              console.log(`Payload for site '${site.name}': ${data.Payload}`)
            }
            resolve()
          },
        )
      })
    }),
  )
}
