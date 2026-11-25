import { describe, expect, it } from 'vitest'
import type {
  ActionResult,
  ActionTools,
  GetActionData,
  QueryActionData,
} from 'deepspace/worker'
import { actions } from './index'

interface Fixture {
  members: string[]
  dates: Array<{ recordId: string; addedBy: string }>
  votes: Array<{ recordId: string; optionId: string; userId: string; value: number }>
}

function envelope(recordId: string, data: Record<string, unknown>) {
  return {
    recordId,
    data,
    createdBy: 'test-user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeTools(fixture: Fixture) {
  const created: Array<{ collection: string; data: Record<string, unknown> }> = []
  const records: Record<string, ReturnType<typeof envelope>[]> = {
    users: fixture.members.map((id) => envelope(id, { name: id })),
    options: fixture.dates.map(({ recordId, addedBy }) =>
      envelope(recordId, {
        roomId: 'room',
        kind: 'date',
        title: '2026-12-01',
        pros: [],
        cons: [],
        addedBy,
      }),
    ),
    votes: fixture.votes.map(({ recordId, optionId, userId, value }) =>
      envelope(recordId, { roomId: 'room', optionId, userId, value }),
    ),
  }

  const tools: ActionTools = {
    async create<T extends Record<string, unknown>>(collection: string, data: T) {
      created.push({ collection, data })
      return { success: true, data: { recordId: 'created' } }
    },
    async update<T extends Record<string, unknown>>() {
      return { success: true, data: { recordId: 'updated' } }
    },
    async remove() {
      return { success: true, data: { recordId: 'removed' } }
    },
    async deleteWhere() {
      return { success: true, data: { deleted: 0 } }
    },
    async get<T extends Record<string, unknown>>(
      collection: string,
      recordId: string,
    ): Promise<ActionResult<GetActionData<T>>> {
      const data =
        collection === 'rooms'
          ? { status: 'open', ownerId: 'u1' }
          : {
              roomId: 'room',
              kind: 'location',
              title: 'Seattle',
              pros: [],
              cons: [],
              addedBy: 'u1',
            }
      return {
        success: true,
        data: {
          record: {
            ...envelope(recordId, data),
            data: data as unknown as T,
          },
        },
      }
    },
    async query<T extends Record<string, unknown>>(
      collection: string,
      options?: { where?: Record<string, unknown> },
    ): Promise<ActionResult<QueryActionData<T>>> {
      const source = records[collection] ?? []
      const filtered = options?.where
        ? source.filter((record) =>
            Object.entries(options.where ?? {}).every(([key, value]) => record.data[key] === value),
          )
        : source
      return {
        success: true,
        data: {
          records: filtered.map((record) => ({
            ...record,
            data: record.data as unknown as T,
          })),
          count: filtered.length,
        },
      }
    },
    async integration<T>() {
      return { success: true, data: {} as T }
    },
    async registerUser() {
      return {
        success: true,
        data: { user: { id: 'u1', name: 'User', email: 'user@example.test', role: 'member' } },
      }
    },
  }

  return { tools, created }
}

function context(
  tools: ActionTools,
  params: Record<string, unknown>,
): Parameters<typeof actions.addRoomLocation>[0] {
  return {
    userId: 'u1',
    params,
    tools,
    env: {} as Parameters<typeof actions.addRoomLocation>[0]['env'],
    callerJwt: 'test-token',
  }
}

describe('room date stage', () => {
  it('does not allow locations until every member submits a date', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1' }],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    const result = await actions.addRoomLocation(context(tools, { roomId: 'room', title: 'Seattle' }))

    expect(result).toMatchObject({ success: false })
    expect(created).toHaveLength(0)
  })

  it('does not allow locations until a date has a vote', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      votes: [],
    })

    const result = await actions.addRoomLocation(context(tools, { roomId: 'room', title: 'Seattle' }))

    expect(result).toMatchObject({ success: false })
    expect(created).toHaveLength(0)
  })

  it('allows locations after all members submit and a date is voted on', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    const result = await actions.addRoomLocation(context(tools, { roomId: 'room', title: 'Seattle' }))

    expect(result).toMatchObject({ success: true })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      collection: 'options',
      data: { kind: 'location', roomId: 'room', title: 'Seattle' },
    })
  })

  it('does not allow location votes before the date stage is complete', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1' }],
      votes: [],
    })

    const result = await actions.castRoomVote({
      ...context(tools, { roomId: 'room', optionId: 'location-1', value: 1 }),
    })

    expect(result).toMatchObject({ success: false })
  })
})
