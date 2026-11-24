import type { CollectionSchema } from 'deepspace/schema'

export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'optionId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      immutable: true,
    },
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
    { name: 'value', storage: 'number', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['optionId', 'userId'],
  ownerField: 'userId',
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
