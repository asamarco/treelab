import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Treelab',
    short_name: 'Treelab',
    description: 'Create and manage data trees with custom templates.',
    start_url: '/',
    display: 'standalone',
    background_color: '#1a282b',
    theme_color: '#1a282b',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}
