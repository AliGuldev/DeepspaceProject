import type { CollectionSchema } from 'deepspace/schema'

export const eventSearchesSchema: CollectionSchema = {
  name: 'eventSearches',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'cacheKey', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'events', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  ownerField: 'roomId',
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
