import type { CollectionSchema } from 'deepspace/schema'

export const PLACE_TYPES = [
  'Food & Drink',
  'Nature & Outdoors',
  'Shopping',
  'Arts & Culture',
  'Entertainment',
  'Games & Recreation',
  'Active & Sports',
  'Wellness & Relaxation',
  'Creative & Learning',
  'Family & Kids',
  'Social & Community',
  'Travel & Exploration',
  'Seasonal & Special',
  'Nightlife',
] as const
export type PlaceType = (typeof PLACE_TYPES)[number]

export const optionsSchema: CollectionSchema = {
  name: 'options',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'kind',
      storage: 'text',
      interpretation: { kind: 'select', options: ['option', 'date', 'location'] },
      required: true,
      default: 'option',
    },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'placeType',
      storage: 'text',
      interpretation: { kind: 'select', options: [...PLACE_TYPES] },
    },
    { name: 'pros', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'cons', storage: 'text', interpretation: { kind: 'json' }, required: true },
    {
      name: 'addedBy',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
  ],
  ownerField: 'addedBy',
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
