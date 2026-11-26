import type { CollectionSchema } from 'deepspace/schema'

export const roomCalendarEventsSchema: CollectionSchema = {
  name: 'roomCalendarEvents',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['created', 'needs_auth', 'failed'] },
      required: true,
    },
    { name: 'calendarEventCreatedAt', storage: 'text', interpretation: 'plain' },
    {
      name: 'ownerId',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      userBound: true,
      immutable: true,
    },
  ],
  ownerField: 'ownerId',
  permissions: {
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: false },
  },
}
