/**
 * This one-off script is to update the ACL of a few objects that were uploaded
 * without proper permissions.
 */
import aws from 'aws-sdk'
import { config } from 'dotenv'

config()

const SCREENSHOTS_TO_FIX = [
  'bosglb-2019-12-07T00:44:09.109Z.png',
  'lemonde-2019-12-07T00:44:25.831Z.png',
  'usatoday-2019-12-07T00:44:00.390Z.png',
  'wsj-2019-12-07T00:44:08.317Z.png',
  'wapo-2019-12-07T00:43:47.373Z.png',
  'nyt-2019-12-07T00:43:30.981Z.png',
  'nyt-2019-12-07T00:42:44.445Z.png',
  'nyt-2019-12-07T00:13:39.047Z.png',
]

const main = () => {
  const s3 = new aws.S3()
  SCREENSHOTS_TO_FIX.forEach(screenshot => {
    s3.putObjectAcl(
      {
        ACL: 'bucket-owner-full-control',
        Bucket: process.env.BUCKET_NAME as string,
        Key: screenshot,
      },
      error => {
        if (error) {
          console.error(`Setting ACL on screenshot failed. Error: ${error}`)
          return
        }

        console.log(`Successfully set ACL on screenshot ${screenshot}`)
      },
    )
  })
}

main()
