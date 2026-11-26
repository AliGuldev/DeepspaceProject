import { describe, expect, it, vi } from 'vitest'
import type {
  ActionResult,
  ActionTools,
  GetActionData,
  QueryActionData,
} from 'deepspace/worker'
import { getEventVoteOptionId } from '../lib/event-votes'
import type { PlaceType } from '../schemas/options-schema'
import { actions, chooseWinningDate } from './index'

interface Fixture {
  members: string[]
  dates: Array<{ recordId: string; addedBy: string; title?: string; createdAt?: string }>
  locations?: Array<{
    recordId: string
    addedBy: string
    title: string
    placeType?: PlaceType
    createdAt?: string
  }>
  votes: Array<{ recordId: string; optionId: string; userId: string; value: number }>
  emailIntegrationError?: boolean
  eventIntegrationError?: boolean
  eventIntegrationErrorForLocation?: string
  calendarIntegrationError?: boolean
  calendarRequiresOAuth?: boolean
  eventResponse?: unknown
  roomStatus?: string
  eventSnapshot?: unknown
}

function envelope(
  recordId: string,
  data: Record<string, unknown>,
  createdAt = '2026-01-01T00:00:00.000Z',
) {
  return {
    recordId,
    data,
    createdBy: 'test-user',
    createdAt,
    updatedAt: createdAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function makeTools(fixture: Fixture) {
  const created: Array<{ collection: string; data: Record<string, unknown> }> = []
  const updated: Array<{
    collection: string
    recordId: string
    data: Record<string, unknown>
  }> = []
  const integrationCalls: Array<{ endpoint: string; data: unknown }> = []
  const roomData: Record<string, unknown> = {
    title: 'Test room',
    status: fixture.roomStatus ?? 'open',
    ownerId: 'u1',
    ...(fixture.eventSnapshot === undefined
      ? {}
      : { eventSnapshot: fixture.eventSnapshot }),
  }
  const records: Record<string, ReturnType<typeof envelope>[]> = {
    users: fixture.members.map((id) =>
      envelope(id, { name: id, email: `${id}@example.test` }),
    ),
    options: [
      ...fixture.dates.map(({ recordId, addedBy, title, createdAt }) =>
        envelope(recordId, {
          roomId: 'room',
          kind: 'date',
          title: title ?? '2026-12-01',
          pros: [],
          cons: [],
          addedBy,
        }, createdAt),
      ),
      ...(fixture.locations ?? []).map(({ recordId, addedBy, title, placeType, createdAt }) =>
        envelope(recordId, {
          roomId: 'room',
          kind: 'location',
          title,
          placeType: placeType ?? 'Nature & Outdoors',
          pros: [],
          cons: [],
          addedBy,
        }, createdAt),
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
    async update<T extends Record<string, unknown>>(
      collection: string,
      recordId: string,
      data: T,
    ) {
      updated.push({ collection, recordId, data })
      if (collection === 'rooms') Object.assign(roomData, data)
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
          ? roomData
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
    async integration<T>(endpoint: string, data?: unknown): Promise<ActionResult<T>> {
      integrationCalls.push({ endpoint, data })
      if (endpoint === 'email/send') {
        if (fixture.emailIntegrationError) {
          return { success: false, error: 'Email service is unavailable.' }
        }
        return { success: true, data: { messageId: 'email-1' } as T }
      }
      if (endpoint === 'google/calendar-create-event') {
        if (fixture.calendarIntegrationError) {
          return { success: false, error: 'Google Calendar is unavailable.' }
        }
        return {
          success: true,
          data: fixture.calendarRequiresOAuth
            ? {
                requiresOAuth: true,
                authUrl: 'https://accounts.google.test/authorize',
              } as T
            : { eventId: 'calendar-event-1' } as T,
        }
      }
      if (fixture.eventIntegrationError) throw new Error('Exa is temporarily unavailable.')
      if (
        fixture.eventIntegrationErrorForLocation &&
        typeof data === 'object' &&
        data !== null &&
        'query' in data &&
        typeof data.query === 'string' &&
        data.query.includes(` in ${fixture.eventIntegrationErrorForLocation}`)
      ) {
        throw new Error(`Exa failed for ${fixture.eventIntegrationErrorForLocation}.`)
      }
      const query = isRecord(data) && typeof data.query === 'string' ? data.query : ''
      const readableDate = query.match(/\bon ([A-Z][a-z]+ \d{1,2}, \d{4})$/)?.[1]
      const requestedDate = readableDate
        ? new Date(`${readableDate} UTC`).toISOString().slice(0, 10)
        : 'unknown'
      const requestedCity = query.match(/\bin (.+) on [A-Z][a-z]+ \d{1,2}, \d{4}$/)?.[1]
        ?.split(',')[0] ?? 'unknown'
      return {
        success: true,
        data: {
          ...(fixture.eventResponse ?? {
            results: [{
              title: 'Pair Event',
              url: 'https://events.example.test/pair-event',
              publishedDate: '2026-12-01',
              summary: `CITY: ${requestedCity}\nDATE: ${requestedDate}. An event for the location.`,
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

  return { tools, created, updated, integrationCalls }
}

function context(
  tools: ActionTools,
  params: Record<string, unknown>,
  apiKey = 'test-api-key',
): Parameters<typeof actions.addRoomLocation>[0] {
  return {
    userId: 'u1',
    params,
    tools,
    env: { GEOAPIFY_API_KEY: apiKey } as Parameters<typeof actions.addRoomLocation>[0]['env'],
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
          query: `hikes, gardens, scenic walks, outdoor activities in Seattle, Washington on ${readableDate}`,
          numResults: 15,
          type: 'auto',
          userLocation: 'US',
          contents: {
            summary: {
              query: 'Include CITY: the city where the event takes place, or CITY: unknown. Include DATE: YYYY-MM-DD if this is a dated event on a specific day, otherwise DATE: unknown. Also include the event or activity name, time, and venue.',
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const city = new URL(input.toString()).searchParams.get('text') ?? 'Seattle'
      const state = city === 'Portland' ? 'Oregon' : 'Washington'
      return new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: city,
            city,
            state,
            formatted: `${city}, ${state}, United States`,
            lat: city === 'Portland' ? 45.5 : 47.6,
            lon: city === 'Portland' ? -122.7 : -122.3,
          },
        }],
      }), { status: 200 })
    })
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [{ recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
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
        votes: [
          { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
          { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
        ],
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const city = new URL(input.toString()).searchParams.get('text') ?? 'Seattle'
      return new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: city,
            city,
            formatted: `${city}, United States`,
            lat: city === 'Portland' ? 45.5 : 47.6,
            lon: city === 'Portland' ? -122.7 : -122.3,
          },
        }],
      }), { status: 200 })
    })
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
      eventResponse: {
        results: [
          {
            title: 'Matching event',
            url: 'https://events.example.test/matching',
            summary: `**CITY:** Seattle\n**DATE:** ${date}. Event details.\nVenue: Seattle Art Museum, Seattle`,
          },
          {
            title: 'Different date',
            url: 'https://events.example.test/different',
            summary: 'CITY: Seattle\nDATE: 2099-12-02. Event details.\nVenue: Seattle theater',
          },
          {
            title: 'Unknown date',
            url: 'https://events.example.test/unknown',
            publishedDate: date,
            summary: 'CITY: Seattle\nDATE: unknown. Event details.\nVenue: Seattle gallery',
          },
          {
            title: 'Missing date',
            url: 'https://events.example.test/missing',
            summary: 'CITY: unknown\nEvent details without a date.\nVenue: Seattle library',
          },
          {
            title: 'Arts Missoula homepage',
            url: 'https://artsmissoula.org/',
            summary: `CITY: Seattle\nDATE: ${date}. Homepage content.`,
            subpages: [
              {
                title: 'Individual arts event',
                url: 'https://artsmissoula.org/events/individual-art-event',
                summary: `**CITY:** Seattle\n**DATE:** ${date}. Event details.`,
              },
              {
                title: 'Arts events listing',
                url: 'https://artsmissoula.org/events',
                summary: `CITY: Seattle\nDATE: ${date}.`,
              },
              {
                title: 'Multi-event guide',
                url: 'https://artsmissoula.org/events/multi-event-guide',
                summary: { isSingleEvent: false },
                highlights: [`CITY: Seattle\nDATE: ${date}.`],
              },
            ],
          },
          {
            title: 'Duplicate individual arts event',
            url: 'https://artsmissoula.org/events/individual-art-event',
            summary: `CITY: Seattle\nDATE: ${date}. Duplicate.`,
          },
          {
            title: 'Portland event',
            url: 'https://events.example.test/portland',
            summary: `CITY: Portland\nDATE: 2099-12-02. Event details.\nVenue: Portland Art Museum, Portland`,
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
        query: `concerts, comedy shows, live performances, sporting events in Seattle on ${readableDate}`,
        numResults: 15,
        includeDomains: ['ticketmaster.com', 'songkick.com', 'seatgeek.com'],
        contents: {
          summary: {
            query: 'Include CITY: the city where the event takes place, or CITY: unknown. Include DATE: YYYY-MM-DD if this is a dated event on a specific day, otherwise DATE: unknown. Also include the event or activity name, time, and venue.',
          },
        },
      })
      expect(integrationCalls[1].data).not.toHaveProperty('includeDomains')
      expect(integrationCalls[1].data).toMatchObject({
        query: `hikes, gardens, scenic walks, outdoor activities in Portland on ${readableDate}`,
      })
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'dropped listing URLs=2, non-single events=1, duplicate URLs=1',
        ),
      )
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('wrong city=1'))

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
              events: [{ title: 'Portland event', eventDate: '2099-12-02' }],
            },
          ],
        },
      })
    } finally {
      fetchMock.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('logs Kirkland Exa candidates, domains, and city-filter counts', async () => {
    const date = '2099-12-01'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            name: 'Kirkland',
            city: 'Kirkland',
            state: 'Washington',
            country_code: 'us',
            formatted: 'Kirkland, Washington, United States',
            lat: 47.7,
            lon: -122.2,
          },
        }],
      }), { status: 200 }),
    )
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1', title: date }],
      locations: [{
        recordId: 'kirkland',
        addedBy: 'u1',
        title: 'Kirkland',
        placeType: 'Arts & Culture',
      }],
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-1', userId: 'u2', value: 1 },
      ],
      eventResponse: {
        results: [{
          title: 'Kirkland arts event',
          url: 'https://events.example.test/kirkland',
          summary: `CITY: Kirkland\nDATE: ${date}\nVENUE: Kirkland Arts Center`,
        }],
      },
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(logSpy).toHaveBeenCalledWith('Exa domains for Kirkland:', [])
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Exa candidate for Kirkland: url=https://events.example.test/kirkland, isSubpage=false, summary=CITY: Kirkland',
        ),
      )
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('wrong city=0'))
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
    })

    try {
      const first = await actions.getRoomWeather(context(tools, { roomId: 'room' }))
      const second = await actions.getRoomWeather(context(tools, { roomId: 'room' }))

      expect(integrationCalls).toHaveLength(3)
      expect(created.filter((entry) => entry.collection === 'eventSearches').map(
        (entry) => entry.data.cacheKey,
      )).toEqual([
        'exa-v7:loc-1:seattle:2099-12-01:Nature & Outdoors',
        'exa-v7:loc-2:portland:2099-12-01:Nature & Outdoors',
        'exa-v7:loc-3:boston:2099-12-01:Nature & Outdoors',
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
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

  it('accepts votes only for events in the current room recommendations', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [{ recordId: 'loc-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'date-vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'date-vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
    })
    const weather = await actions.getRoomWeather(context(tools, { roomId: 'room' }, ''))
    if (!weather.success) throw new Error('Expected event recommendations to load.')
    const locationEvents =
      isRecord(weather.data) && Array.isArray(weather.data.events)
        ? weather.data.events[0]
        : null
    const event =
      isRecord(locationEvents) && Array.isArray(locationEvents.events)
        ? locationEvents.events[0]
        : null
    if (
      !isRecord(event) ||
      typeof event.title !== 'string' ||
      (event.url !== null && typeof event.url !== 'string') ||
      typeof event.eventDate !== 'string'
    ) {
      throw new Error('Expected an event recommendation.')
    }
    const eventTarget = {
      locationId: 'loc-1',
      title: event.title,
      url: event.url,
      eventDate: event.eventDate,
    }
    const optionId = getEventVoteOptionId('room', eventTarget)

    const result = await actions.castRoomVote(context(tools, {
      roomId: 'room',
      optionId,
      event: eventTarget,
      value: 1,
    }))

    expect(result).toMatchObject({ success: true })
    expect(created).toContainEqual({
      collection: 'votes',
      data: { roomId: 'room', optionId, userId: 'u1', value: 1 },
    })

    const unavailableResult = await actions.castRoomVote(context(tools, {
      roomId: 'room',
      optionId: getEventVoteOptionId('room', {
        locationId: 'loc-1',
        title: 'Unlisted event',
        url: 'https://events.example.test/unlisted',
        eventDate: '2099-12-01',
      }),
      event: {
        locationId: 'loc-1',
        title: 'Unlisted event',
        url: 'https://events.example.test/unlisted',
        eventDate: '2099-12-01',
      },
      value: -1,
    }))
    expect(unavailableResult).toMatchObject({
      success: false,
      error: 'This event is no longer in the current recommendations.',
    })
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
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

  it('allows locations after two date votes without every member adding a date', async () => {
    const { tools, created } = makeTools({
      members: ['u1', 'u2', 'u3'],
      dates: [{ recordId: 'date-1', addedBy: 'u1' }],
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-1', userId: 'u2', value: 1 },
      ],
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
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
      votes: [
        { recordId: 'vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
      ],
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

  it('emails room participants the ranked voting results when the host closes the room', async () => {
    const { tools, updated, integrationCalls } = makeTools({
      members: ['u1', 'u2', 'u3'],
      dates: [
        { recordId: 'date-1', addedBy: 'u1' },
        { recordId: 'date-2', addedBy: 'u2' },
        { recordId: 'date-3', addedBy: 'u3' },
      ],
      locations: [
        {
          recordId: 'location-a',
          addedBy: 'u1',
          title: 'More vetoes',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          recordId: 'location-b',
          addedBy: 'u1',
          title: 'Earliest with fewest vetoes',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          recordId: 'location-c',
          addedBy: 'u2',
          title: 'Later with fewest vetoes',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        {
          recordId: 'location-d',
          addedBy: 'u3',
          title: 'Fewer approvals',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      votes: [
        { recordId: 'date-vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'date-vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
        { recordId: 'date-vote-3', optionId: 'date-2', userId: 'u3', value: 1 },
        { recordId: 'location-a-1', optionId: 'location-a', userId: 'u1', value: 1 },
        { recordId: 'location-a-2', optionId: 'location-a', userId: 'u2', value: 1 },
        { recordId: 'location-a-3', optionId: 'location-a', userId: 'u3', value: -1 },
        { recordId: 'location-b-1', optionId: 'location-b', userId: 'u1', value: 1 },
        { recordId: 'location-b-2', optionId: 'location-b', userId: 'u2', value: 1 },
        { recordId: 'location-c-1', optionId: 'location-c', userId: 'u1', value: 1 },
        { recordId: 'location-c-2', optionId: 'location-c', userId: 'u2', value: 1 },
        { recordId: 'location-d-1', optionId: 'location-d', userId: 'u1', value: 1 },
        {
          recordId: 'event-vote-1',
          optionId: getEventVoteOptionId('room', {
            locationId: 'location-a',
            title: 'Pair Event',
            url: 'https://events.example.test/pair-event',
            eventDate: '2026-12-01',
          }),
          userId: 'u3',
          value: 1,
        },
      ],
    })
    const update = vi.spyOn(tools, 'update')

    const result = await actions.closeRoom(context(tools, { roomId: 'room' }, ''))

    expect(result).toMatchObject({ success: true })
    expect(update).toHaveBeenCalledWith('rooms', 'room', { status: 'closed' })
    expect(integrationCalls.filter((call) => call.endpoint === 'email/send')).toHaveLength(1)
    expect(integrationCalls.filter((call) => call.endpoint === 'exa/search')).toHaveLength(4)
    const snapshotUpdate = updated.find(
      (entry) => entry.collection === 'rooms' && 'eventSnapshot' in entry.data,
    )
    expect(snapshotUpdate?.data.eventSnapshot).toMatchObject([
      { locationId: 'location-d', events: [{ title: 'Pair Event' }] },
      { locationId: 'location-a', events: [{ title: 'Pair Event' }] },
      { locationId: 'location-b', events: [{ title: 'Pair Event' }] },
      { locationId: 'location-c', events: [{ title: 'Pair Event' }] },
    ])
    const emailCall = integrationCalls.find((call) => call.endpoint === 'email/send')
    expect(emailCall).toMatchObject({
      endpoint: 'email/send',
      data: {
        to: 'u1@example.test',
        bcc: ['u2@example.test', 'u3@example.test'],
        subject: 'Voting results: Test room',
      },
    })
    if (!emailCall || !isRecord(emailCall.data) || typeof emailCall.data.text !== 'string') {
      throw new Error('Expected the email to include the voting results.')
    }
    expect(emailCall.data.text).toContain('Selected date: 2026-12-01')
    expect(emailCall.data.text).toContain(
      'Winning location: Earliest with fewest vetoes',
    )
    expect(emailCall.data.text).toContain('More vetoes: 2 approvals, 1 vetoes')
    expect(emailCall.data.text).toContain(
      'Earliest with fewest vetoes: 2 approvals, 0 vetoes',
    )
    expect(emailCall.data.text).toContain('Event vote results:')
    expect(emailCall.data.text).toContain(
      'Pair Event (More vetoes) — https://events.example.test/pair-event: 1 approvals, 0 vetoes',
    )
    expect(integrationCalls.find((call) => call.endpoint === 'google/calendar-create-event'))
      .toMatchObject({
        data: {
          title: 'Pair Event',
          start: '2026-12-01',
          end: '2026-12-02',
          allDay: true,
          location: 'More vetoes',
          attendees: ['u1@example.test', 'u2@example.test', 'u3@example.test'],
          sendUpdates: 'all',
        },
      })
    expect(updated.some(
      (entry) =>
        entry.collection === 'rooms' &&
        entry.data.calendarEventStatus === 'created' &&
        typeof entry.data.calendarEventCreatedAt === 'string',
    )).toBe(true)
  })

  it('uses the winning room date and location when no event has votes', async () => {
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1', title: '2026-12-01' }],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Kirkland' }],
      votes: [
        { recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
      eventIntegrationError: true,
    })

    const result = await actions.closeRoom(context(tools, { roomId: 'room' }, ''))

    expect(result).toMatchObject({
      success: true,
      data: { calendarEventCreated: true },
    })
    expect(integrationCalls.find((call) => call.endpoint === 'google/calendar-create-event'))
      .toMatchObject({
        data: {
          title: 'Test room',
          start: '2026-12-01',
          end: '2026-12-02',
          allDay: true,
          location: 'Kirkland',
        },
      })
  })

  it('returns Google authorization and allows a closed-room calendar retry', async () => {
    const fixture: Fixture = {
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1', title: '2026-12-01' }],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Kirkland' }],
      votes: [
        { recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
      eventIntegrationError: true,
      calendarRequiresOAuth: true,
    }
    const { tools, integrationCalls, updated } = makeTools(fixture)

    const closed = await actions.closeRoom(context(tools, { roomId: 'room' }, ''))

    expect(closed).toMatchObject({
      success: true,
      data: {
        calendarEventCreated: false,
        calendarAuthUrl: 'https://accounts.google.test/authorize',
      },
    })
    expect(updated.some(
      (entry) =>
        entry.collection === 'rooms' &&
        entry.data.calendarEventStatus === 'needs_auth',
    )).toBe(true)

    const nonHostContext = context(tools, { roomId: 'room' }, '')
    nonHostContext.userId = 'u2'
    const deniedRetry = await actions.createRoomCalendarEvent(nonHostContext)
    expect(deniedRetry).toMatchObject({
      success: false,
      error: 'Only the room host can add its calendar event.',
    })

    fixture.calendarRequiresOAuth = false
    const retried = await actions.createRoomCalendarEvent(
      context(tools, { roomId: 'room' }, ''),
    )
    const duplicate = await actions.createRoomCalendarEvent(
      context(tools, { roomId: 'room' }, ''),
    )

    expect(retried).toMatchObject({
      success: true,
      data: { calendarEventCreated: true },
    })
    expect(duplicate).toMatchObject({
      success: true,
      data: { calendarEventCreated: true },
    })
    expect(integrationCalls.filter((call) => call.endpoint === 'google/calendar-create-event'))
      .toHaveLength(2)
    expect(updated.some(
      (entry) =>
        entry.collection === 'rooms' &&
        entry.data.calendarEventStatus === 'created',
    )).toBe(true)
  })

  it('reports an email failure after successfully closing the room', async () => {
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
      emailIntegrationError: true,
    })
    const update = vi.spyOn(tools, 'update')

    const result = await actions.closeRoom(context(tools, { roomId: 'room' }, ''))

    expect(result).toMatchObject({
      success: true,
      data: {
        emailSent: false,
        warning: 'Room closed, but the voting result email could not be sent: Email service is unavailable.',
      },
    })
    expect(update).toHaveBeenCalledWith('rooms', 'room', { status: 'closed' })
  })

  it('serves a closed room event snapshot without searching Exa again', async () => {
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      roomStatus: 'closed',
      eventSnapshot: [{
        locationId: 'location-1',
        events: [{
          title: 'Frozen event',
          url: 'https://events.example.test/frozen',
          eventDate: '2099-12-01',
          summary: 'A frozen event.',
        }],
      }],
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'date-vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'date-vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
    })

    const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }, ''))

    expect(result).toMatchObject({
      success: true,
      data: { events: [{ locationId: 'location-1', events: [{ title: 'Frozen event' }] }] },
    })
    expect(integrationCalls).toHaveLength(0)
  })

  it('does not run fresh event searches for older closed rooms without a snapshot', async () => {
    const { tools, integrationCalls } = makeTools({
      members: ['u1', 'u2'],
      roomStatus: 'closed',
      dates: [
        { recordId: 'date-1', addedBy: 'u1', title: '2099-12-01' },
        { recordId: 'date-2', addedBy: 'u2', title: '2099-12-01' },
      ],
      locations: [{ recordId: 'location-1', addedBy: 'u1', title: 'Seattle' }],
      votes: [
        { recordId: 'date-vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'date-vote-2', optionId: 'date-2', userId: 'u2', value: 1 },
        { recordId: 'location-vote', optionId: 'location-1', userId: 'u2', value: 1 },
      ],
    })

    const result = await actions.getRoomWeather(context(tools, { roomId: 'room' }, ''))

    expect(result).toMatchObject({
      success: true,
      data: { events: [{ locationId: 'location-1', events: [] }] },
    })
    expect(integrationCalls).toHaveLength(0)
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

  it('does not allow location votes before two date votes', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2'],
      dates: [{ recordId: 'date-1', addedBy: 'u1' }],
      votes: [{ recordId: 'date-vote', optionId: 'date-1', userId: 'u1', value: 1 }],
    })

    const result = await actions.castRoomVote({
      ...context(tools, { roomId: 'room', optionId: 'location-1', value: 1 }),
    })

    expect(result).toMatchObject({ success: false })
  })

  it('allows location voting after two date votes without every member adding a date', async () => {
    const { tools } = makeTools({
      members: ['u1', 'u2', 'u3'],
      dates: [{ recordId: 'date-1', addedBy: 'u1' }],
      votes: [
        { recordId: 'date-vote-1', optionId: 'date-1', userId: 'u1', value: 1 },
        { recordId: 'date-vote-2', optionId: 'date-1', userId: 'u2', value: -1 },
      ],
    })

    const result = await actions.castRoomVote({
      ...context(tools, { roomId: 'room', optionId: 'location-1', value: 1 }),
    })

    expect(result).toMatchObject({ success: true })
  })
})
