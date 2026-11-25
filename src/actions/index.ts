import type { ActionHandler, ActionTools, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'

interface RoomData extends Record<string, unknown> {
  status: string
  ownerId: string
}

interface OptionData extends Record<string, unknown> {
  roomId: string
  kind: 'option' | 'date' | 'location'
  title: string
  pros: string[]
  cons: string[]
  addedBy: string
}

interface VoteData extends Record<string, unknown> {
  roomId: string
  optionId: string
  userId: string
  value: number
}

type RoomOptionRecord = QueryActionData<OptionData>['records'][number]

interface WeatherLocationResult {
  locationId: string
  locationTitle: string
  resolvedPlace: string | null
  condition: string | null
  temperatureMin: number | null
  temperatureMax: number | null
  precipitation: number | null
  precipitationUnit: string | null
  precipitationKind: 'probability' | 'total' | null
  error?: string
}

interface RoomWeatherResult {
  selectedDateId: string
  selectedDate: string
  locations: WeatherLocationResult[]
}

interface ResolvedLocation {
  lat: number
  lon: number
  name: string
  state: string | null
  country: string | null
}

type GeocodeResult = ResolvedLocation | { error: string }

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const failure = (error: string) => ({ success: false as const, error })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function chooseWinningDate(
  dates: Array<{ recordId: string; createdAt: string }>,
  votes: Array<{ data: Pick<VoteData, 'optionId' | 'value'> }>,
): string | null {
  const totals = new Map<string, { approvals: number; vetoes: number }>()
  for (const date of dates) totals.set(date.recordId, { approvals: 0, vetoes: 0 })
  for (const vote of votes) {
    const total = totals.get(vote.data.optionId)
    if (!total) continue
    if (vote.data.value === 1) total.approvals += 1
    if (vote.data.value === -1) total.vetoes += 1
  }

  const rankedDates = [...dates].sort((left, right) => {
    const leftTotal = totals.get(left.recordId) ?? { approvals: 0, vetoes: 0 }
    const rightTotal = totals.get(right.recordId) ?? { approvals: 0, vetoes: 0 }
    return (
      rightTotal.approvals - leftTotal.approvals ||
      leftTotal.vetoes - rightTotal.vetoes ||
      left.createdAt.localeCompare(right.createdAt)
    )
  })
  return rankedDates[0]?.recordId ?? null
}

function weatherDescription(code: number | null): string | null {
  if (code === null) return null
  if (code === 0) return 'Clear sky'
  if (code === 1) return 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code === 51 || code === 53 || code === 55) return 'Drizzle'
  if (code === 56 || code === 57) return 'Freezing drizzle'
  if (code === 61 || code === 63 || code === 65) return 'Rain'
  if (code === 66 || code === 67) return 'Freezing rain'
  if (code === 71 || code === 73 || code === 75 || code === 77) return 'Snow'
  if (code === 80 || code === 81 || code === 82) return 'Rain showers'
  if (code === 85 || code === 86) return 'Snow showers'
  if (code === 95 || code === 96 || code === 99) return 'Thunderstorm'
  return `Weather code ${code}`
}

function numberAt(values: unknown, index: number): number | null {
  if (!Array.isArray(values)) return null
  const value: unknown = values[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function distanceBetweenPlaces(left: ResolvedLocation, right: ResolvedLocation): number {
  const radians = (degrees: number) => degrees * (Math.PI / 180)
  const latitudeDelta = radians(right.lat - left.lat)
  const longitudeDelta = radians(right.lon - left.lon)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.lat)) *
      Math.cos(radians(right.lat)) *
      Math.sin(longitudeDelta / 2) ** 2
  const boundedHaversine = Math.min(1, Math.max(0, haversine))
  return 2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine))
}

function createLocationResolver(apiKey: string | undefined) {
  const cache = new Map<string, Promise<GeocodeResult>>()

  return async function resolveLocation(
    input: string,
    anchor: ResolvedLocation | null,
  ): Promise<GeocodeResult> {
    const cached = cache.get(input)
    if (cached) return cached

    const result = (async (): Promise<GeocodeResult> => {
      if (!apiKey) return { error: 'Geoapify API key is not configured.' }

      try {
        const url = new URL('https://api.geoapify.com/v1/geocode/search')
        url.searchParams.set('text', input)
        url.searchParams.set('limit', '10')
        url.searchParams.set('format', 'geojson')
        url.searchParams.set('apiKey', apiKey)
        if (anchor) {
          url.searchParams.set('bias', `proximity:${anchor.lon},${anchor.lat}`)
        }

        const response = await fetch(url)
        if (!response.ok) return { error: `Geocoding failed (HTTP ${response.status}).` }
        const payload: unknown = await response.json()
        if (!isObject(payload) || !Array.isArray(payload.features)) {
          return { error: 'Geocoding returned an invalid response.' }
        }

        const locations = payload.features.flatMap((feature): ResolvedLocation[] => {
          if (!isObject(feature) || !isObject(feature.properties)) return []
          const { lat, lon, name, city, address_line1, state, country } = feature.properties
          const resolvedName =
            typeof name === 'string'
              ? name
              : typeof city === 'string'
                ? city
                : address_line1
          if (
            typeof lat !== 'number' ||
            !Number.isFinite(lat) ||
            typeof lon !== 'number' ||
            !Number.isFinite(lon) ||
            typeof resolvedName !== 'string'
          ) {
            return []
          }

          return [{
            lat,
            lon,
            name: resolvedName,
            state: typeof state === 'string' ? state : null,
            country: typeof country === 'string' ? country : null,
          }]
        })
        if (locations.length === 0) return { error: 'No matching place was found.' }

        const exactMatches = anchor
          ? locations.filter(
              (location) =>
                location.name.toLowerCase() === input.toLowerCase(),
            )
          : []
        const location = anchor && exactMatches.length > 0
          ? exactMatches.reduce((closest, candidate) =>
              distanceBetweenPlaces(candidate, anchor) < distanceBetweenPlaces(closest, anchor)
                ? candidate
                : closest,
            )
          : locations[0]

        return location
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Geocoding could not be completed.',
        }
      }
    })()
    cache.set(input, result)
    return result
  }
}

function getDailyWeather(
  payload: unknown,
  date: string,
  isArchive: boolean,
): Omit<WeatherLocationResult, 'locationId' | 'locationTitle' | 'resolvedPlace'> {
  if (!isObject(payload)) {
    return { condition: null, temperatureMin: null, temperatureMax: null, precipitation: null, precipitationUnit: null, precipitationKind: null, error: 'Weather data was unavailable for this date.' }
  }

  const daily = payload.daily
  if (!isObject(daily) || !Array.isArray(daily.time)) {
    return { condition: null, temperatureMin: null, temperatureMax: null, precipitation: null, precipitationUnit: null, precipitationKind: null, error: 'Weather data was unavailable for this date.' }
  }

  const index = daily.time.indexOf(date)
  if (index < 0) {
    return { condition: null, temperatureMin: null, temperatureMax: null, precipitation: null, precipitationUnit: null, precipitationKind: null, error: 'Weather data was unavailable for this date.' }
  }

  const units = isObject(payload.daily_units) ? payload.daily_units : {}
  const precipitationField = isArchive ? 'precipitation_sum' : 'precipitation_probability_max'
  const code = numberAt(daily.weather_code, index)
  return {
    condition: weatherDescription(code),
    temperatureMin: numberAt(daily.temperature_2m_min, index),
    temperatureMax: numberAt(daily.temperature_2m_max, index),
    precipitation: numberAt(daily[precipitationField], index),
    precipitationUnit:
      typeof units[precipitationField] === 'string'
        ? units[precipitationField]
        : null,
    precipitationKind: isArchive ? 'total' : 'probability',
  }
}

async function getDateStageStatus(
  roomId: string,
  tools: ActionTools,
): Promise<{ complete: boolean } | { error: string }> {
  const [membersResult, datesResult, votesResult] = await Promise.all([
    tools.query('users', { limit: 500 }),
    tools.query<OptionData>('options', { where: { roomId, kind: 'date' }, limit: 500 }),
    tools.query<VoteData>('votes', { where: { roomId }, limit: 500 }),
  ])
  if (!membersResult.success) return { error: membersResult.error }
  if (!datesResult.success) return { error: datesResult.error }
  if (!votesResult.success) return { error: votesResult.error }

  if (
    membersResult.data.count > membersResult.data.records.length ||
    datesResult.data.count > datesResult.data.records.length ||
    votesResult.data.count > votesResult.data.records.length
  ) {
    return { error: 'Could not verify date participation for all records.' }
  }

  const dateSubmitters = new Set(datesResult.data.records.map((date) => date.data.addedBy))
  const allMembersSubmitted =
    membersResult.data.records.length > 0 &&
    membersResult.data.records.every((member) => dateSubmitters.has(member.recordId))
  const dateIds = new Set(datesResult.data.records.map((date) => date.recordId))
  const hasVotedDate = votesResult.data.records.some((vote) => dateIds.has(vote.data.optionId))

  return { complete: allMembersSubmitted && hasVotedDate }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const actions: Record<string, ActionHandler<Env>> = {
  addRoomDate: async ({ userId, params, tools }) => {
    const roomId = requiredString(params.roomId)
    const title = requiredString(params.title)
    if (!roomId || !title || !isValidDate(title)) {
      return failure('Room and a valid date are required.')
    }

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    if (roomResult.data.record.data.status !== 'open') {
      return failure('Dates can only be added to an open room.')
    }

    const dateStage = await getDateStageStatus(roomId, tools)
    if ('error' in dateStage) return failure(dateStage.error)
    if (dateStage.complete) return failure('The date stage is complete.')

    const existingDates = await tools.query<OptionData>('options', {
      where: { roomId, kind: 'date', addedBy: userId },
      limit: 1,
    })
    if (!existingDates.success) return existingDates

    const existingDate = existingDates.data.records[0]
    return existingDate
      ? tools.update<OptionData>('options', existingDate.recordId, { title })
      : tools.create<OptionData>('options', {
          roomId,
          kind: 'date',
          title,
          pros: [],
          cons: [],
          addedBy: userId,
        })
  },

  addRoomLocation: async ({ userId, params, tools }) => {
    const roomId = requiredString(params.roomId)
    const title = requiredString(params.title)
    if (!roomId || !title) return failure('Room and location are required.')

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    if (roomResult.data.record.data.status !== 'open') {
      return failure('Locations can only be added to an open room.')
    }

    const dateStage = await getDateStageStatus(roomId, tools)
    if ('error' in dateStage) return failure(dateStage.error)
    if (!dateStage.complete) {
      return failure('Every member must add a date and at least one date must be voted on first.')
    }

    return tools.create<OptionData>('options', {
      roomId,
      kind: 'location',
      title,
      pros: [],
      cons: [],
      addedBy: userId,
    })
  },

  getRoomWeather: async ({ params, tools, env }) => {
    const roomId = requiredString(params.roomId)
    if (!roomId) return failure('Room is required.')

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    const dateStage = await getDateStageStatus(roomId, tools)
    if ('error' in dateStage) return failure(dateStage.error)
    if (!dateStage.complete) {
      return failure('Weather is available after every member submits a date and a date is voted on.')
    }

    const [datesResult, locationsResult, votesResult] = await Promise.all([
      tools.query<OptionData>('options', { where: { roomId, kind: 'date' }, limit: 500 }),
      tools.query<OptionData>('options', { where: { roomId, kind: 'location' }, limit: 500 }),
      tools.query<VoteData>('votes', { where: { roomId }, limit: 500 }),
    ])
    if (!datesResult.success) return datesResult
    if (!locationsResult.success) return locationsResult
    if (!votesResult.success) return votesResult
    if (
      datesResult.data.count > datesResult.data.records.length ||
      locationsResult.data.count > locationsResult.data.records.length ||
      votesResult.data.count > votesResult.data.records.length
    ) {
      return failure('Could not load all dates, locations, or votes for weather.')
    }

    const selectedDateId = chooseWinningDate(datesResult.data.records, votesResult.data.records)
    const selectedDate = datesResult.data.records.find((date) => date.recordId === selectedDateId)
    if (!selectedDate) return failure('No voted date could be selected.')

    const locations = [...locationsResult.data.records].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
    if (locations.length === 0) {
      return {
        success: true as const,
        data: {
          selectedDateId: selectedDate.recordId,
          selectedDate: selectedDate.data.title,
          locations: [],
        } satisfies RoomWeatherResult,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const dayOffset =
      (Date.parse(`${selectedDate.data.title}T00:00:00.000Z`) -
        Date.parse(`${today}T00:00:00.000Z`)) /
      86_400_000
    if (dayOffset > 16) {
      return {
        success: true as const,
        data: {
          selectedDateId: selectedDate.recordId,
          selectedDate: selectedDate.data.title,
          locations: locations.map((location) => ({
            locationId: location.recordId,
            locationTitle: location.data.title,
            resolvedPlace: null,
            condition: null,
            temperatureMin: null,
            temperatureMax: null,
            precipitation: null,
            precipitationUnit: null,
            precipitationKind: null,
            error: 'Forecasts are available up to 16 days ahead.',
          })),
        } satisfies RoomWeatherResult,
      }
    }

    const resolveLocation = createLocationResolver(env.GEOAPIFY_API_KEY)
    const firstLocation = locations[0]
    const firstResult = await resolveLocation(firstLocation.data.title, null)
    const anchor = 'error' in firstResult ? null : firstResult
    const geocoded = [
      { location: firstLocation, result: firstResult },
      ...await Promise.all(
        locations.slice(1).map(async (location) => ({
          location,
          result: await resolveLocation(location.data.title, anchor),
        })),
      ),
    ]
    const matchedLocations = geocoded.filter(
      (item): item is { location: RoomOptionRecord; result: ResolvedLocation } =>
        !('error' in item.result),
    )
    const weatherByLocationId = new Map<string, WeatherLocationResult>()
    geocoded.forEach(({ location, result }) => {
      if ('error' in result) {
        weatherByLocationId.set(location.recordId, {
          locationId: location.recordId,
          locationTitle: location.data.title,
          resolvedPlace: null,
          condition: null,
          temperatureMin: null,
          temperatureMax: null,
          precipitation: null,
          precipitationUnit: null,
          precipitationKind: null,
          error: result.error,
        })
      }
    })

    if (matchedLocations.length > 0) {
      const isArchive = dayOffset < -7
      const weatherUrl = new URL(
        isArchive
          ? 'https://archive-api.open-meteo.com/v1/archive'
          : 'https://api.open-meteo.com/v1/forecast',
      )
      weatherUrl.searchParams.set(
        'latitude',
        matchedLocations.map(({ result }) => result.lat).join(','),
      )
      weatherUrl.searchParams.set(
        'longitude',
        matchedLocations.map(({ result }) => result.lon).join(','),
      )
      weatherUrl.searchParams.set(
        'daily',
        isArchive
          ? 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
          : 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      )
      weatherUrl.searchParams.set('timezone', 'auto')
      if (isArchive) {
        weatherUrl.searchParams.set('start_date', selectedDate.data.title)
        weatherUrl.searchParams.set('end_date', selectedDate.data.title)
      } else {
        weatherUrl.searchParams.set('past_days', '7')
        weatherUrl.searchParams.set('forecast_days', '16')
      }

      try {
        const response = await fetch(weatherUrl)
        if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`)
        const payload: unknown = await response.json()
        const responses = Array.isArray(payload) ? payload : [payload]
        matchedLocations.forEach(({ location, result }, index) => {
          const item = responses[index]
          const daily = getDailyWeather(item, selectedDate.data.title, isArchive)
          const { name, state, country } = result
          weatherByLocationId.set(location.recordId, {
            locationId: location.recordId,
            locationTitle: location.data.title,
            resolvedPlace: [name, state, country].filter(Boolean).join(', '),
            ...daily,
          })
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Weather could not be retrieved.'
        matchedLocations.forEach(({ location, result }) => {
          const { name, state, country } = result
          weatherByLocationId.set(location.recordId, {
            locationId: location.recordId,
            locationTitle: location.data.title,
            resolvedPlace: [name, state, country].filter(Boolean).join(', '),
            condition: null,
            temperatureMin: null,
            temperatureMax: null,
            precipitation: null,
            precipitationUnit: null,
            precipitationKind: null,
            error: message,
          })
        })
      }
    }

    return {
      success: true as const,
      data: {
        selectedDateId: selectedDate.recordId,
        selectedDate: selectedDate.data.title,
        locations: locations.map(
          (location) =>
            weatherByLocationId.get(location.recordId) ?? {
              locationId: location.recordId,
              locationTitle: location.data.title,
              resolvedPlace: null,
              condition: null,
              temperatureMin: null,
              temperatureMax: null,
              precipitation: null,
              precipitationUnit: null,
              precipitationKind: null,
              error: 'Weather data is unavailable.',
            },
        ),
      } satisfies RoomWeatherResult,
    }
  },

  deleteRoomLocation: async ({ userId, params, tools }) => {
    const optionId = requiredString(params.optionId)
    if (!optionId) return failure('Location is required.')

    const optionResult = await tools.get<OptionData>('options', optionId)
    if (!optionResult.success || optionResult.data.record.data.kind !== 'location') {
      return failure('Location not found.')
    }
    const option = optionResult.data.record.data

    const roomResult = await tools.get<RoomData>('rooms', option.roomId)
    if (!roomResult.success) return failure('Room not found.')
    if (option.addedBy !== userId && roomResult.data.record.data.ownerId !== userId) {
      return failure('Only the location author or room owner can delete this location.')
    }

    return tools.remove('options', optionId)
  },

  castRoomVote: async ({ userId, params, tools }) => {
    const roomId = requiredString(params.roomId)
    const optionId = requiredString(params.optionId)
    const value = params.value
    if (!roomId || !optionId || (value !== 1 && value !== -1)) {
      return failure('Room, option, and a valid vote are required.')
    }

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    if (roomResult.data.record.data.status !== 'open') {
      return failure('This room is closed; voting is no longer allowed.')
    }

    const optionResult = await tools.get<OptionData>('options', optionId)
    if (!optionResult.success || optionResult.data.record.data.roomId !== roomId) {
      return failure('Date or location not found in this room.')
    }
    const candidate = optionResult.data.record.data
    if (candidate.kind !== 'date' && candidate.kind !== 'location') {
      return failure('Date or location not found in this room.')
    }
    if (candidate.kind === 'location') {
      const dateStage = await getDateStageStatus(roomId, tools)
      if ('error' in dateStage) return failure(dateStage.error)
      if (!dateStage.complete) {
        return failure('Every member must add a date and at least one date must be voted on first.')
      }
    }

    const voteQuery = () =>
      tools.query<VoteData>('votes', { where: { optionId, userId }, limit: 1 })
    const existingVotes = await voteQuery()
    if (!existingVotes.success) return existingVotes

    const existingVote = existingVotes.data.records[0]
    if (existingVote) {
      return tools.update<VoteData>('votes', existingVote.recordId, { value })
    }

    const created = await tools.create<VoteData>('votes', { roomId, optionId, userId, value })
    if (created.success) return created

    const racedVotes = await voteQuery()
    if (!racedVotes.success) return racedVotes
    const racedVote = racedVotes.data.records[0]
    return racedVote
      ? tools.update<VoteData>('votes', racedVote.recordId, { value })
      : created
  },
}
