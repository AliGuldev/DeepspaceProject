import { describe, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  ActionTools,
  GetActionData,
  QueryActionData,
} from 'deepspace/worker'
import type { PlaceType } from '../schemas/options-schema'
import { actions, chooseWinningDate } from './index'

interface Fixture {
  members: string[]
  dates: Array<{ recordId: string; addedBy: string; title?: string }>
  locations?: Array<{ recordId: string; addedBy: string; title: string; placeType?: PlaceType }>
  votes: Array<{ recordId: string; optionId: string; userId: string; value: number }>
  eventIntegrationError?: boolean
  eventIntegrationErrorForLocation?: string
  eventResponse?: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function makeTools(fixture: Fixture) {
  const created: Array<{ collection: string; data: Record<string, unknown> }> = []
  const integrationCalls: Array<{ endpoint: string; data: unknown }> = []
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
      ...(fixture.locations ?? []).map(({ recordId, addedBy, title, placeType }) =>
        envelope(recordId, {
          roomId: 'room',
          kind: 'location',
          title,
          placeType: placeType ?? 'Nature & Outdoors',
          pros: [],
          cons: [],
          addedBy,
        }),
      ),
    ],
    votes: fixture.votes.map(({ recordId, optionId, userId, value }) =>
      envelope(recordId, { roomId: 'room', optionId, userId, value }),
    ),
    eventSearches: [],
  }

  const tools: ActionTools = {
    async create<T extends Record<string, unknown>>(collection: string, data: T) {
      created.push({ collection, data })
      if (collection === 'eventSearches') {
        records.eventSearches.push(envelope(`event-cache-${records.eventSearches.length}`, data))
      }
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
    async integration<T>(endpoint: string, data?: unknown) {
      integrationCalls.push({ endpoint, data })
      if (fixture.eventIntegrationError) throw new Error('Exa is temporarily unavailable.')
      if (
        fixture.eventIntegrationErrorForLocation &&
        typeof data === 'object' &&
        data !== null &&
        'query' in data &&
        typeof data.query === 'string' &&
        data.query.includes(` in ${fixture.eventIntegrationErrorForLocation} on `)
      ) {
        throw new Error(`Exa failed for ${fixture.eventIntegrationErrorForLocation}.`)
      }
      const query = isRecord(data) && typeof data.query === 'string' ? data.query : ''
      const requestedDate = query.match(/\bon (\d{4}-\d{2}-\d{2})$/)?.[1] ?? 'unknown'
      return {
        success: true,
        data: {
          ...(fixture.eventResponse ?? {
            results: [{
              title: 'Pair Event',
              url: 'https://events.example.test/pair-event',
              publishedDate: '2026-12-01',
              summary: `DATE: ${requestedDate}. An event for the location.`,
              highlights: ['Event details'],
            }],
          }),
          costUsd: 0.0325,
        } as T,
      }
    },
    async registerUser() {
      return {
        success: true,
        data: { user: { id: 'u1', name: 'User', email: 'user@example.test', role: 'member' } },
      }
    },
  }

  return { tools, created, integrationCalls }
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
    const weatherRequests: URL[] = []
    const geocodingRequests: URL[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.hostname === 'api.geoapify.com') {
        geocodingRequests.push(url)
        const query = url.searchParams.get('text')
        const feature = (name: string, lat: number, lon: number, state: string) => ({
          type: 'Feature',
          properties: {
            name,
            city: name,
            lat,
            lon,
            state,
            country: 'United States',
            country_code: 'us',
            formatted: `${name}, ${state}, United States`,
          },
        })
        const features =
          query === 'Seattle area'
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
      weatherRequests.push(url)
      const latitude = Number(url.searchParams.get('latitude'))
      return new Response(
        JSON.stringify(
          {
            daily: {
              time: [date],
              weather_code: [latitude === 47.6 ? 3 : 0],
              temperature_2m_min: [5],
              temperature_2m_max: [latitude === 45.5 ? 15 : 12],
              precipitation_probability_max: [20],
            },
            daily_units: {
              temperature_2m_min: '°C',
              temperature_2m_max: '°C',
              precipitation_probability_max: '%',
            },
          },
        ),
        { status: 200 },
      )
    })

    try {
      const { tools, integrationCalls } = makeTools({
        members: ['u1', 'u2'],
        dates: [
          { recordId: 'date-1', addedBy: 'u1', title: date },
          { recordId: 'date-2', addedBy: 'u2', title: date },
        ],
        locations: [
          { recordId: 'loc-1', addedBy: 'u1', title: 'Seattle area' },
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
          events: [
            { locationId: 'loc-1', events: [{ title: 'Pair Event' }] },
            { locationId: 'loc-2', events: [{ title: 'Pair Event' }] },
            { locationId: 'loc-3', events: [{ title: 'Pair Event' }] },
            { locationId: 'loc-4', events: [{ title: 'Pair Event' }] },
          ],
        },
      })
      expect(geocodingRequests).toHaveLength(3)
      expect(geocodingRequests[0].searchParams.get('text')).toBe('Seattle area')
      expect(geocodingRequests[0].searchParams.get('limit')).toBe('10')
      expect(geocodingRequests[0].searchParams.get('apiKey')).toBe('test-api-key')
      expect(geocodingRequests[0].searchParams.has('bias')).toBe(false)
      expect(geocodingRequests[1].searchParams.get('bias')).toBe('proximity:-122.3,47.6')
      expect(weatherRequests).toHaveLength(4)
      expect(weatherRequests.map((request) => request.searchParams.get('latitude'))).toEqual([
        '47.6',
        '45.5',
        '0',
        '45.5',
      ])
      expect(weatherRequests.map((request) => request.searchParams.get('longitude'))).toEqual([
        '-122.3',
        '-122.7',
        '0',
        '-122.7',
      ])
      expect(weatherRequests.every((request) =>
        !request.searchParams.get('latitude')?.includes(',') &&
        !request.searchParams.get('longitude')?.includes(','),
      )).toBe(true)
      expect(integrationCalls).toHaveLength(4)
      const readableDate = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${date}T00:00:00.000Z`))
      expect(integrationCalls[0]).toMatchObject({
        endpoint: 'exa/search',
        data: {
          query: `hikes, gardens, scenic walks, outdoor activities in Seattle on ${readableDate} tickets OR register OR RSVP`,
          numResults: 15,
          type: 'auto',
          userLocation: 'US',
          contents: {
            subpages: 5,
            subpageTarget: ['event', 'events', 'calendar'],
            summary: {
              query: 'Include DATE: YYYY-MM-DD if this is a dated event on a specific day, otherwise DATE: unknown. Also include the event or activity name, time, and venue.',
            },
            highlights: { maxCharacters: 300, highlightsPerUrl: 1 },
          },
        },
      })
      expect(integrationCalls[0].data).not.toHaveProperty('includeDomains')
      expect(fetchMock).toHaveBeenCalledTimes(7)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('requests events for a single location', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: 'Seattle',
            city: 'Seattle',
            formatted: 'Seattle, Washington, United States',
            lat: 47.6,
            lon: -122.3,
          },
        }],
      }), { status: 200 }),
    )
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [{ recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    try {
      await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(integrationCalls).toHaveLength(1)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('keeps other locations and weather when one Exa call throws', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString())
      if (url.hostname === 'api.geoapify.com') {
        return new Response(JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {
              name: url.searchParams.get('text'),
              lat: 47.6,
              lon: -122.3,
              state: 'Washington',
              country: 'United States',
            },
          }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify(
        {
          daily: {
            time: [date],
            weather_code: [0],
            temperature_2m_min: [5],
            temperature_2m_max: [12],
            precipitation_probability_max: [20],
          },
          daily_units: {
            temperature_2m_min: '°C',
            temperature_2m_max: '°C',
            precipitation_probability_max: '%',
          },
        },
      ), { status: 200 })
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
          { recordId: 'loc-2', addedBy: 'u2', title: 'Portland' },
        ],
        votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
        eventIntegrationErrorForLocation: 'Seattle',
      })

      const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(result).toMatchObject({
        success: true,
        data: {
          events: [
            { locationId: 'loc-1', error: 'Exa failed for Seattle.' },
            { locationId: 'loc-2', events: [{ title: 'Pair Event' }] },
          ],
          locations: [
            { condition: 'Clear sky' },
            { condition: 'Clear sky' },
          ],
        },
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('applies date filtering by place type and accepts flexible date markers', async () => {
    const date = '2099-12-01'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: 'Seattle',
            city: 'Seattle',
            formatted: 'Seattle, Washington, United States',
            lat: 47.6,
            lon: -122.3,
          },
        }],
      }), { status: 200 }),
    )
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: date },
        { recordId: 'date-2', addedBy: 'u2', title: date },
      ],
      locations: [
        { recordId: 'loc-1', addedBy: 'u1', title: 'Seattle', placeType: 'Entertainment' },
        { recordId: 'loc-2', addedBy: 'u2', title: 'Portland', placeType: 'Nature & Outdoors' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
      eventResponse: {
        results: [
          {
            title: 'Matching event',
            url: 'https://events.example.test/matching',
            summary: `**DATE:** ${date}. Event details.`,
          },
          {
            title: 'Different date',
            url: 'https://events.example.test/different',
            summary: 'DATE: 2099-12-02. Event details.',
          },
          {
            title: 'Unknown date',
            url: 'https://events.example.test/unknown',
            publishedDate: date,
            summary: 'DATE: unknown. Event details.',
          },
          {
            title: 'Missing date',
            url: 'https://events.example.test/missing',
            summary: 'Event details without a date.',
          },
          {
            title: 'Arts Missoula homepage',
            url: 'https://artsmissoula.org/',
            summary: `DATE: ${date}. Homepage content.`,
            subpages: [
              {
                title: 'Individual arts event',
                url: 'https://artsmissoula.org/events/individual-art-event',
                summary: `**DATE:** ${date}. Event details.`,
              },
              {
                title: 'Arts events listing',
                url: 'https://artsmissoula.org/events',
                summary: `DATE: ${date}.`,
              },
              {
                title: 'Multi-event guide',
                url: 'https://artsmissoula.org/events/multi-event-guide',
                summary: { isSingleEvent: false },
                highlights: [`DATE: ${date}.`],
              },
            ],
          },
          {
            title: 'Duplicate individual arts event',
            url: 'https://artsmissoula.org/events/individual-art-event',
            summary: `DATE: ${date}. Duplicate.`,
          },
        ],
      },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      const readableDate = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${date}T00:00:00.000Z`))
      expect(integrationCalls[0].data).toMatchObject({
        query: `concerts, comedy shows, live performances, sporting events in Seattle on ${readableDate} tickets OR register OR RSVP`,
        numResults: 15,
        includeDomains: ['ticketmaster.com', 'songkick.com', 'seatgeek.com'],
        contents: {
          subpages: 5,
          subpageTarget: ['event', 'events', 'calendar'],
        },
      })
      expect(integrationCalls[1].data).not.toHaveProperty('includeDomains')
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'dropped listing URLs=2, non-single events=1, duplicate URLs=1',
        ),
      )

      expect(result).toMatchObject({
        success: true,
        data: {
          events: [
            {
              locationId: 'loc-1',
              events: [
                { title: 'Matching event', eventDate: date },
                { title: 'Unknown date', eventDate: 'unknown' },
                { title: 'Missing date', eventDate: 'unknown' },
                { title: 'Individual arts event', eventDate: date },
              ],
            },
            {
              locationId: 'loc-2',
              events: [
                { title: 'Matching event', eventDate: date },
                { title: 'Different date', eventDate: '2099-12-02' },
                { title: 'Unknown date', eventDate: 'unknown' },
                { title: 'Missing date', eventDate: 'unknown' },
                { title: 'Individual arts event', eventDate: date },
              ],
            },
          ],
        },
      })
    } finally {
      fetchMock.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('reuses event caches independently for each location and selected date', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString())
      const name = url.searchParams.get('text') ?? 'Location'
      return new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name,
            city: name,
            formatted: `${name}, United States`,
            lat: 47.6,
            lon: -122.3,
          },
        }],
      }), { status: 200 })
    })
    const { tools, integrationCalls, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [
        { recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' },
        { recordId: 'loc-2', addedBy: 'u2', title: 'Portland' },
        { recordId: 'loc-3', addedBy: 'u1', title: 'Boston' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    try {
      const first = await actions.getRoomWeather(context(tools, { roomId: 'room' }))
      const second = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(integrationCalls).toHaveLength(3)
      expect(created.filter((entry) => entry.collection === 'eventSearches').map(
        (entry) => entry.data.cacheKey,
      )).toEqual([
        'exa-v6:loc-1:2099-12-01:Nature & Outdoors',
        'exa-v6:loc-2:2099-12-01:Nature & Outdoors',
        'exa-v6:loc-3:2099-12-01:Nature & Outdoors',
      ])
      expect(first).toMatchObject({
        success: true,
        data: { events: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }, { locationId: 'loc-3' }] },
      })
      expect(second).toMatchObject({
        success: true,
        data: { events: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }, { locationId: 'loc-3' }] },
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('does not cache empty Exa results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: 'Seattle',
            city: 'Seattle',
            formatted: 'Seattle, Washington, United States',
            lat: 47.6,
            lon: -122.3,
          },
        }],
      }), { status: 200 }),
    )
    const { tools, integrationCalls, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [
        { recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' },
        { recordId: 'loc-2', addedBy: 'u2', title: 'Portland' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
      eventResponse: { results: [] },
    })

    try {
      await actions.getRoomWeather(context(tools, { roomId: 'room' }))
      await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(integrationCalls).toHaveLength(4)
      expect(created.filter((entry) => entry.collection === 'eventSearches')).toHaveLength(0)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('limits Exa searches to ten locations and tags skipped results by id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString())
      const name = url.searchParams.get('text') ?? 'Location'
      return new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name,
            city: name,
            formatted: `${name}, United States`,
            lat: 47.6,
            lon: -122.3,
          },
        }],
      }), { status: 200 })
    })
    const locations = Array.from({ length: 12 }, (_, index) => ({
      recordId: `loc-${index + 1}`,
      addedBy: index % 2 === 0 ? 'u1' : 'u2',
      title: `City ${index + 1}`,
    }))
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations,
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    try {
      const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(integrationCalls).toHaveLength(10)
      expect(integrationCalls.every((call) => call.endpoint === 'exa/search')).toBe(true)
      expect(integrationCalls.every((call) =>
        isRecord(call.data) && !('userLocation' in call.data),
      )).toBe(true)
      if (!result.success) throw new Error(result.error)
      if (!isRecord(result.data) || !Array.isArray(result.data.events)) {
        throw new Error('Expected per-location event results.')
      }
      const resultsByLocationId = new Map<string, Record<string, unknown>>()
      result.data.events.forEach((event: unknown) => {
        if (isRecord(event) && typeof event.locationId === 'string') {
          resultsByLocationId.set(event.locationId, event)
        }
      })
      expect(resultsByLocationId.size).toBe(12)
      expect(resultsByLocationId.has('loc-1')).toBe(true)
      expect(resultsByLocationId.has('loc-10')).toBe(true)
      expect(resultsByLocationId.get('loc-11')).toMatchObject({ skipped: true })
      expect(resultsByLocationId.get('loc-12')).toMatchObject({ skipped: true })
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

    const result = await actions.addRoomLocation(
      context(tools, { roomId: 'room', title: 'Seattle', placeType: 'Nature & Outdoors' }),
    )

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

    const result = await actions.addRoomLocation(
      context(tools, { roomId: 'room', title: 'Seattle', placeType: 'Nature & Outdoors' }),
    )

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

    const result = await actions.addRoomLocation(
      context(tools, { roomId: 'room', title: 'Seattle', placeType: 'Nature & Outdoors' }),
    )

    expect(result).toMatchObject({ success: true })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      collection: 'options',
      data: {
        kind: 'location',
        roomId: 'room',
        title: 'Seattle',
        placeType: 'Nature & Outdoors',
      },
    })
  })

  it('requires a valid place type when adding a location', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      votes: [{ recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    const result = await actions.addRoomLocation(
      context(tools, { roomId: 'room', title: 'Seattle', placeType: 'invalid' }),
    )

    expect(result).toMatchObject({ success: false })
    expect(created).toHaveLength(0)
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
        context(tools, {
          roomId: 'room',
          latitude: 42.36,
          longitude: -71.06,
          placeType: 'Nature & Outdoors',
        }),
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
          placeType: 'Nature & Outdoors',
        },
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('lets the host close a room after a location has a vote', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
    })
    const update = vi.spyOn(tools, 'update')

    const result = await actions.closeRoom(context(tools, { roomId: 'room' }))

    expect(result).toMatchObject({ success: true })
    expect(update).toHaveBeenCalledWith('rooms', 'room', { status: 'closed' })
  })

  it('does not let the host close a room before any location has a vote', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [{ recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 }],
    })
    const update = vi.spyOn(tools, 'update')

    const result = await actions.closeRoom(context(tools, { roomId: 'room' }))

    expect(result).toMatchObject({ success: false })
    expect(update).not.toHaveBeenCalled()
  })

  it('only lets the room host close the room', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
      ],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
    })
    const nonHostContext = context(tools, { roomId: 'room' })
    nonHostContext.userId = 'u2'
    const update = vi.spyOn(tools, 'update')

    const result = await actions.closeRoom(nonHostContext)

    expect(result).toMatchObject({ success: false, error: 'Only the room host can close this room.' })
    expect(update).not.toHaveBeenCalled()
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
