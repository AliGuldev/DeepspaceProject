import { describe, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  ActionTools,
  GetActionData,
  QueryActionData,
} from 'deepspace/worker'
import { actions, chooseWinningDate } from './index'

interface Fixture {
  members: string[]
  dates: Array<{ recordId: string; addedBy: string; title?: string }>
  locations?: Array<{ recordId: string; addedBy: string; title: string }>
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
    options: [
      ...fixture.dates.map(({ recordId, addedBy, title }) =>
        envelope(recordId, {
          roomId: 'room',
          kind: 'date',
          title: title ?? '2026-12-01',
          pros: [],
          cons: [],
          addedBy,
        }),
      ),
      ...(fixture.locations ?? []).map(({ recordId, addedBy, title }) =>
        envelope(recordId, {
          roomId: 'room',
          kind: 'location',
          title,
          pros: [],
          cons: [],
          addedBy,
        }),
      ),
    ],
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
    env: { GEOAPIFY_API_KEY: 'test-api-key' } as Parameters<typeof actions.addRoomLocation>[0]['env'],
    callerJwt: 'test-token',
  }
}

describe('room date stage', () => {
  it('fetches weather for every location using the winning date', async () => {
    const date = new Date().toISOString().slice(0, 10)
    let weatherRequest: URL | undefined
    const geocodingRequests: URL[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.hostname === 'api.geoapify.com') {
        geocodingRequests.push(url)
        const query = url.searchParams.get('text')
        const feature = (name: string, lat: number, lon: number, state: string) => ({
          type: 'Feature',
          properties: { name, lat, lon, state, country: 'United States' },
        })
        const features =
          query === 'Seattle'
            ? [feature('Seattle', 47.6, -122.3, 'Washington')]
            : query === 'portland'
              ? [
                  feature('Portland', 43.66, -70.25, 'Maine'),
                  feature('Portland', 45.5, -122.7, 'Oregon'),
                ]
              : [
                  feature('Candidate One', 0, 0, 'State One'),
                  feature('Candidate Two', 47.7, -122.3, 'State Two'),
                ]
        return new Response(
          JSON.stringify({ type: 'FeatureCollection', features }),
          { status: 200 },
        )
      }
      weatherRequest = url
      return new Response(
        JSON.stringify(
          Array.from({ length: 4 }, (_, index) => ({
            daily: {
              time: [date],
              weather_code: [index === 0 ? 3 : 0],
              temperature_2m_min: [5],
              temperature_2m_max: [index === 1 ? 15 : 12],
              precipitation_probability_max: [20],
            },
            daily_units: {
              temperature_2m_min: '°C',
              temperature_2m_max: '°C',
              precipitation_probability_max: '%',
            },
          })),
        ),
        { status: 200 },
      )
    })

    try {
      const { tools } = makeTools({
        members: ['u1', 'u2'],
        dates: [
          { recordId: 'date-1', addedBy: 'u1', title: date },
          { recordId: 'date-2', addedBy: 'u2', title: date },
        ],
        locations: [
          { recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' },
          { recordId: 'loc-2', addedBy: 'u2', title: 'portland' },
          { recordId: 'loc-3', addedBy: 'u1', title: 'Unmapped query' },
          { recordId: 'loc-4', addedBy: 'u2', title: 'portland' },
        ],
        votes: [
          { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
          { recordId: 'vote-2', optionId: 'date-2', userId: 'u1', value: 1 },
          { recordId: 'vote-3', optionId: 'date-2', userId: 'u2', value: 1 },
        ],
      })

      const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(result).toMatchObject({
        success: true,
        data: {
          selectedDateId: 'date-2',
          selectedDate: date,
          locations: [
            { locationId: 'loc-1', condition: 'Overcast', temperatureMax: 12, precipitationKind: 'probability' },
            {
              locationId: 'loc-2',
              condition: 'Clear sky',
              temperatureMax: 15,
              precipitationKind: 'probability',
              resolvedPlace: 'Portland, Oregon, United States',
            },
            { locationId: 'loc-3', resolvedPlace: 'Candidate One, State One, United States' },
            { locationId: 'loc-4', resolvedPlace: 'Portland, Oregon, United States' },
          ],
        },
      })
      expect(geocodingRequests).toHaveLength(3)
      expect(geocodingRequests[0].searchParams.get('text')).toBe('Seattle')
      expect(geocodingRequests[0].searchParams.get('limit')).toBe('10')
      expect(geocodingRequests[0].searchParams.get('apiKey')).toBe('test-api-key')
      expect(geocodingRequests[0].searchParams.has('bias')).toBe(false)
      expect(geocodingRequests[1].searchParams.get('bias')).toBe('proximity:-122.3,47.6')
      expect(weatherRequest?.searchParams.get('latitude')).toBe('47.6,45.5,0,45.5')
      expect(weatherRequest?.searchParams.get('longitude')).toBe('-122.3,-122.7,0,-122.7')
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('ranks dates by approvals, then vetoes, then submission time', () => {
    const dates = [
      { recordId: 'earlier', createdAt: '2026-01-01T00:00:00.000Z' },
      { recordId: 'fewer-vetoes', createdAt: '2026-01-02T00:00:00.000Z' },
      { recordId: 'more-approvals', createdAt: '2026-01-03T00:00:00.000Z' },
    ]
    const votes = [
      { data: { optionId: 'earlier', value: 1 as const } },
      { data: { optionId: 'earlier', value: 1 as const } },
      { data: { optionId: 'earlier', value: -1 as const } },
      { data: { optionId: 'fewer-vetoes', value: 1 as const } },
      { data: { optionId: 'fewer-vetoes', value: 1 as const } },
      { data: { optionId: 'more-approvals', value: 1 as const } },
      { data: { optionId: 'more-approvals', value: 1 as const } },
      { data: { optionId: 'more-approvals', value: 1 as const } },
    ]

    expect(chooseWinningDate(dates, votes)).toBe('more-approvals')
    expect(
      chooseWinningDate(
        dates.slice(0, 2),
        votes.filter((vote) => vote.data.optionId !== 'more-approvals'),
      ),
    ).toBe('fewer-vetoes')
    expect(
      chooseWinningDate(dates.slice(0, 2), [
        { data: { optionId: 'earlier', value: 1 } },
        { data: { optionId: 'fewer-vetoes', value: 1 } },
      ]),
    ).toBe('earlier')
  })

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

  it('reverse geocodes and adds the browser location', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })
    let reverseRequest: URL | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      reverseRequest = new URL(input.toString())
      return new Response(
        JSON.stringify({
          results: [{
            city: 'Boston',
            state: 'Massachusetts',
            country: 'United States',
          }],
        }),
        { status: 200 },
      )
    })

    try {
      const result = await actions.addRoomLocation(
        context(tools, { roomId: 'room', latitude: 42.36, longitude: -71.06 }),
      )

      expect(result).toMatchObject({ success: true })
      expect(reverseRequest?.hostname).toBe('api.geoapify.com')
      expect(reverseRequest?.pathname).toBe('/v1/geocode/reverse')
      expect(reverseRequest?.searchParams.get('lat')).toBe('42.36')
      expect(reverseRequest?.searchParams.get('lon')).toBe('-71.06')
      expect(created[0]).toMatchObject({
        collection: 'options',
        data: {
          kind: 'location',
          title: 'Boston, Massachusetts, United States',
        },
      })
    } finally {
      fetchMock.mockRestore()
    }
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
