export interface Site {
  id: number
  name: string
  url: string
  selector: string
  shortcode: string
  createdAt: string
  updatedAt: string
  script?: string
}

export interface Headline {
  title: string
  url: string
}
