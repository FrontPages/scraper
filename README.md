## Deployment

This repo uses [Serverless Framework](https://serverless.com/framework/docs/) for deployment.

### Prerequisites

You must have a `.env` file in the root directory of the repo with the following environment variables set:

- `BUCKET_NAME`: The name of the S3 bucket to store screenshots in.
- `FRONT_PAGES_API_KEY`: The API key used to post snapshots to Front Pages.
- `FRONT_PAGES_BASE_URL` (optional): The base URL for Front Pages API requests. If not provided, `http://front-pages-sandbox.herokuapp.com` will be used [by default](https://github.com/FrontPages/scraper/blob/fb6654800e380be3b91b551473db7cbfa73aefd1/scraper.ts#L9).

This file will be used by `serverless-dotenv-plugin` to publish these variables to production on deploy.
