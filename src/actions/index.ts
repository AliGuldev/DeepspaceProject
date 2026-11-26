import type { ActionHandler, ActionTools, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'
import { PLACE_TYPES, type PlaceType } from '../schemas/options-schema'

interface RoomData extends Record<string, unknown> {
  status: string
  ownerId: string
}

interface OptionData extends Record<string, unknown> {
  roomId: string
  kind: 'option' | 'date' | 'location'
  title: string
  placeType?: PlaceType
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
  events: LocationEventResult[]
}

interface EventSummary {
  title: string
  url: string | null
  eventDate: string
  summary: string | null
}

interface LocationEventResult {
  locationId: string
  events: EventSummary[]
  error?: string
  warning?: string
  skipped?: boolean
}

interface EventSearchData extends Record<string, unknown> {
  roomId: string
  cacheKey: string
  events: EventSummary[]
}

interface ExaEventFilterCounts {
  candidates: number
  listingUrls: number
  nonSingleEvents: number
  duplicateUrls: number
  missingTitles: number
  mismatchedDates: number
}

interface ResolvedLocation {
  lat: number
  lon: number
  name: string
  address: string
  city: string
  state: string | null
  country: string | null
  countryCode: string | null
}

type GeocodeResult = ResolvedLocation | { error: string }

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const failure = (error: string) => ({ success: false as const, error })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isPlaceType(value: unknown): value is PlaceType {
  return PLACE_TYPES.some((placeType) => placeType === value)
}

type PlaceTypeSearchConfig = { terms: string; domains?: string[]; dated: boolean }

const GENERIC_PLACE_TYPE_SEARCH: PlaceTypeSearchConfig = {
  terms: 'local activities and things to do',
  dated: false,
}

const PLACE_TYPE_SEARCH: Record<PlaceType, PlaceTypeSearchConfig> = {
  'Food & Drink': { terms: 'food festivals, tastings, pop-ups', dated: false },
  'Nature & Outdoors': { terms: 'hikes, gardens, scenic walks, outdoor activities', dated: false },
  Shopping: { terms: 'markets, pop-up shops, craft fairs', dated: false },
  'Arts & Culture': { terms: 'art exhibitions, gallery openings, theater, performances', dated: true },
  Entertainment: {
    terms: 'concerts, comedy shows, live performances, sporting events',
    domains: ['ticketmaster.com', 'songkick.com', 'seatgeek.com'],
    dated: true,
  },
  'Games & Recreation': { terms: 'arcades, board game cafes, escape rooms, recreation activities', dated: false },
  'Active & Sports': { terms: 'sports activities, cycling, climbing, fitness classes', dated: false },
  'Wellness & Relaxation': { terms: 'spa experiences, yoga, meditation, wellness activities', dated: false },
  'Creative & Learning': { terms: 'workshops, classes, makerspaces, learning activities', dated: false },
  'Family & Kids': { terms: "family activities, kids attractions, children's workshops", dated: false },
  'Social & Community': { terms: 'community events, meetups, gatherings, networking events', dated: true },
  'Travel & Exploration': {
    terms: 'tours, sightseeing, attractions, day trips',
    domains: ['viator.com', 'getyourguide.com', 'tripadvisor.com'],
    dated: false,
  },
  'Seasonal & Special': { terms: 'seasonal events, festivals, holiday celebrations', dated: true },
  Nightlife: {
    terms: 'club nights, DJ sets, live music, bar events',
    domains: ['ra.co', 'dice.fm'],
    dated: true,
  },
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const LISTING_URL_SEGMENTS = new Set([
  'events',
  'event',
  'calendar',
  'whats-on',
  'things-to-do',
  'shows',
  'tickets',
  'search',
])

function looksLikeListingUrl(url: unknown): boolean {
  if (typeof url !== 'string') return true
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    if (segments.length === 0) return true
    if (segments.length !== 1) return false
    return LISTING_URL_SEGMENTS.has(decodeURIComponent(segments[0]).toLowerCase())
  } catch {
    return true
  }
}

function parseExaEvents(
  payload: unknown,
  selectedDate: string,
  dated: boolean,
  filterCounts: ExaEventFilterCounts,
): EventSummary[] | null {
  if (!isObject(payload) || !Array.isArray(payload.results)) return null

  const candidates = payload.results.flatMap((value): Record<string, unknown>[] => {
    if (!isObject(value)) return []
    const subpages = Array.isArray(value.subpages)
      ? value.subpages.filter(isObject)
      : []
    return [value, ...subpages]
  })
  filterCounts.candidates = candidates.length
  const seenUrls = new Set<string>()

  return candidates.flatMap((candidate): EventSummary[] => {
    if (looksLikeListingUrl(candidate.url)) {
      filterCounts.listingUrls += 1
      return []
    }

    const structuredSummary = isObject(candidate.summary) ? candidate.summary : null
    if (structuredSummary?.isSingleEvent === false) {
      filterCounts.nonSingleEvents += 1
      return []
    }

    const title = requiredString(candidate.title)
    if (!title) {
      filterCounts.missingTitles += 1
      return []
    }
    const url = httpUrl(candidate.url)
    const highlights = Array.isArray(candidate.highlights)
      ? candidate.highlights.filter((highlight): highlight is string => typeof highlight === 'string')
      : []
    const summary =
      requiredString(candidate.summary) ??
      (highlights.length > 0 ? highlights.join(' ') : null)
    const dateText = [summary, ...highlights].filter(Boolean).join(' ')
    const parsedDate = dateText.match(/\bDATE\W{0,4}\s*(\d{4}-\d{2}-\d{2}|unknown)/i)?.[1]
    const eventDate = parsedDate?.toLowerCase() === 'unknown' ? 'unknown' : parsedDate ?? 'unknown'
    if (dated && eventDate !== selectedDate && eventDate !== 'unknown') {
      filterCounts.mismatchedDates += 1
      return []
    }
    if (url && seenUrls.has(url)) {
      filterCounts.duplicateUrls += 1
      return []
    }
    if (url) seenUrls.add(url)

    return [{
      title,
      url,
      eventDate,
      summary,
    }]
  })
}

async function searchEventsForLocations(
  roomId: string,
  locations: Array<{ location: RoomOptionRecord; result: GeocodeResult }>,
  selectedDate: string,
  tools: ActionTools,
): Promise<LocationEventResult[]> {
  const limitedLocations = locations.slice(0, 10)
  const results = await Promise.all(
    limitedLocations.map(async ({ location, result: geocodeResult }): Promise<LocationEventResult> => {
      const locationId = location.recordId
      const placeType = isPlaceType(location.data.placeType) ? location.data.placeType : undefined
      const config = placeType ? PLACE_TYPE_SEARCH[placeType] : GENERIC_PLACE_TYPE_SEARCH
      const resolved = 'error' in geocodeResult ? null : geocodeResult
      const city = resolved?.city ?? location.data.title
      const cacheKey = `exa-v6:${locationId}:${selectedDate}:${placeType ?? 'generic'}`

      try {
        const cachedResult = await tools.query<EventSearchData>('eventSearches', {
          where: { roomId, cacheKey },
          limit: 1,
        })
        if (!cachedResult.success) {
          return {
            locationId,
            events: [],
            error: `Could not load cached events: ${cachedResult.error}`,
          }
        }
        const cached = cachedResult.data.records[0]
        if (cached) return { locationId, events: cached.data.events }

        const readableDate = new Intl.DateTimeFormat('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${selectedDate}T00:00:00.000Z`))
        const request = {
          query: `${config.terms} in ${city} on ${readableDate} tickets OR register OR RSVP`,
          numResults: 15,
          type: 'auto',
          ...(config.domains ? { includeDomains: config.domains } : {}),
          contents: {
            subpages: 5,
            subpageTarget: ['event', 'events', 'calendar'],
            summary: {
              query: 'Include DATE: YYYY-MM-DD if this is a dated event on a specific day, otherwise DATE: unknown. Also include the event or activity name, time, and venue.',
            },
            highlights: { maxCharacters: 300, highlightsPerUrl: 1 },
          },
        }
        const result = await tools.integration<unknown>(
          'exa/search',
          resolved?.countryCode
            ? { ...request, userLocation: resolved.countryCode.toUpperCase() }
            : request,
        )
        if (!result.success) {
          return { locationId, events: [], error: result.error }
        }

        const rawResultCount =
          isObject(result.data) && Array.isArray(result.data.results)
            ? result.data.results.length
            : 0
        const filterCounts: ExaEventFilterCounts = {
          candidates: 0,
          listingUrls: 0,
          nonSingleEvents: 0,
          duplicateUrls: 0,
          missingTitles: 0,
          mismatchedDates: 0,
        }
        const events = parseExaEvents(result.data, selectedDate, config.dated, filterCounts)
        console.log(
          `Exa results for ${locationId} (${placeType ?? 'generic'}) on ${selectedDate}: ${rawResultCount} results, ${filterCounts.candidates} candidates, ${events?.length ?? 0} kept; dropped listing URLs=${filterCounts.listingUrls}, non-single events=${filterCounts.nonSingleEvents}, duplicate URLs=${filterCounts.duplicateUrls}, missing titles=${filterCounts.missingTitles}, mismatched dates=${filterCounts.mismatchedDates}`,
        )
        if (!events) {
          return {
            locationId,
            events: [],
            error: 'Exa returned an invalid events response.',
          }
        }
        if (events.length === 0) return { locationId, events }

        const saved = await tools.create<EventSearchData>('eventSearches', {
          roomId,
          cacheKey,
          events,
        })
        return saved.success
          ? { locationId, events }
          : {
              locationId,
              events,
              warning: `Could not cache event results: ${saved.error}`,
            }
      } catch (error) {
        return {
          locationId,
          events: [],
          error: error instanceof Error ? error.message : 'Event search could not be completed.',
        }
      }
    }),
  )
  return [
    ...results,
    ...locations.slice(10).map(({ location }): LocationEventResult => ({
      locationId: location.recordId,
      events: [],
      skipped: true,
    })),
  ]
}

function failedEventSearches(
  locations: Array<{ location: RoomOptionRecord; result: GeocodeResult }>,
  error: string,
): LocationEventResult[] {
  return locations.map(({ location }, index) =>
    index < 10
      ? { locationId: location.recordId, events: [], error }
      : { locationId: location.recordId, events: [], skipped: true },
  )
}

async function reverseGeocodeLocation(
  latitude: number,
  longitude: number,
  apiKey: string | undefined,
): Promise<{ title: string } | { error: string }> {
  if (!apiKey) return { error: 'Geoapify API key is not configured.' }

  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/reverse')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('format', 'json')
    url.searchParams.set('apiKey', apiKey)

    const response = await fetch(url)
    if (!response.ok) return { error: `Geocoding failed (HTTP ${response.status}).` }
    const payload: unknown = await response.json()
    if (!isObject(payload) || !Array.isArray(payload.results)) {
      return { error: 'Geocoding returned an invalid response.' }
    }

    const result = payload.results[0]
    if (!isObject(result)) return { error: 'No matching place was found for your location.' }

    const name =
      typeof result.city === 'string'
        ? result.city
        : typeof result.name === 'string'
          ? result.name
          : result.address_line1
    if (typeof name !== 'string' || !name.trim()) {
      return { error: 'Could not determine a place name for your location.' }
    }

    return {
      title: [name, result.state, result.country]
        .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        .join(', '),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Geocoding could not be completed.',
    }
  }
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
          const {
            lat,
            lon,
            name,
            city,
            address_line1,
            formatted,
            state,
            country,
            country_code,
          } = feature.properties
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

          const addressParts = [address_line1, city, state, country]
            .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
            .join(', ')
          return [{
            lat,
            lon,
            name: resolvedName,
            address: requiredString(formatted) ?? (addressParts || resolvedName),
            city: typeof city === 'string' && city.trim() ? city : input,
            state: typeof state === 'string' ? state : null,
            country: typeof country === 'string' ? country : null,
            countryCode:
              typeof country_code === 'string' && country_code.trim()
                ? country_code.trim().toUpperCase()
                : null,
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

  addRoomLocation: async ({ userId, params, tools, env }) => {
    const roomId = requiredString(params.roomId)
    let title = requiredString(params.title)
    const placeType = params.placeType
    const latitude = params.latitude
    const longitude = params.longitude
    const hasCoordinates =
      isCoordinate(latitude, -90, 90) && isCoordinate(longitude, -180, 180)
    if (!roomId || !isPlaceType(placeType) || (!title && !hasCoordinates)) {
      return failure('Room, location, and a valid type of place are required.')
    }

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

    if (!title) {
      if (!isCoordinate(latitude, -90, 90) || !isCoordinate(longitude, -180, 180)) {
        return failure('A valid latitude and longitude are required.')
      }
      const location = await reverseGeocodeLocation(latitude, longitude, env.GEOAPIFY_API_KEY)
      if ('error' in location) return failure(location.error)
      title = location.title
    }

    return tools.create<OptionData>('options', {
      roomId,
      kind: 'location',
      title,
      placeType,
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
          events: [],
        } satisfies RoomWeatherResult,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const dayOffset =
      (Date.parse(`${selectedDate.data.title}T00:00:00.000Z`) -
        Date.parse(`${today}T00:00:00.000Z`)) /
      86_400_000

    const resolveLocation = createLocationResolver(env.GEOAPIFY_API_KEY)
    const firstLocation = locations[0]
    const firstResult = await resolveLocation(firstLocation.data.title, null)
    const anchor = 'error' in firstResult ? null : firstResult
    const geocodedByLocationId = new Map<string, GeocodeResult>([
      [firstLocation.recordId, firstResult],
    ])
    const otherGeocodes = await Promise.all(
      locations.slice(1).map(async (location) => ({
        locationId: location.recordId,
        result: await resolveLocation(location.data.title, anchor),
      })),
    )
    otherGeocodes.forEach(({ locationId, result }) => {
      geocodedByLocationId.set(locationId, result)
    })
    const geocoded = locations.map((location) => ({
      location,
      result: geocodedByLocationId.get(location.recordId) ?? {
        error: 'Geocoding data was unavailable for this location.',
      },
    }))
    let events: LocationEventResult[]
    try {
      events = await searchEventsForLocations(
        roomId,
        geocoded,
        selectedDate.data.title,
        tools,
      )
    } catch (error) {
      events = failedEventSearches(
        geocoded,
        error instanceof Error ? error.message : 'Event search could not be completed.',
      )
    }

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
          events,
        } satisfies RoomWeatherResult,
      }
    }

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

    const isArchive = dayOffset < -7
    await Promise.all(matchedLocations.map(async ({ location, result }) => {
      const weatherUrl = new URL(
        isArchive
          ? 'https://archive-api.open-meteo.com/v1/archive'
          : 'https://api.open-meteo.com/v1/forecast',
      )
      weatherUrl.searchParams.set('latitude', String(result.lat))
      weatherUrl.searchParams.set('longitude', String(result.lon))
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
        const daily = getDailyWeather(payload, selectedDate.data.title, isArchive)
        const { name, state, country } = result
        weatherByLocationId.set(location.recordId, {
          locationId: location.recordId,
          locationTitle: location.data.title,
          resolvedPlace: [name, state, country].filter(Boolean).join(', '),
          ...daily,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Weather could not be retrieved.'
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
      }
    }))

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
        events,
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
    if (roomResult.data.record.data.status !== 'open') {
      return failure('Locations cannot be deleted from a closed room.')
    }
    if (option.addedBy !== userId && roomResult.data.record.data.ownerId !== userId) {
      return failure('Only the location author or room owner can delete this location.')
    }

    return tools.remove('options', optionId)
  },

  closeRoom: async ({ userId, params, tools }) => {
    const roomId = requiredString(params.roomId)
    if (!roomId) return failure('Room is required.')

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    const room = roomResult.data.record.data
    if (room.ownerId !== userId) return failure('Only the room host can close this room.')
    if (room.status !== 'open') return failure('This room is already closed.')

    const [locationsResult, votesResult] = await Promise.all([
      tools.query<OptionData>('options', { where: { roomId, kind: 'location' }, limit: 500 }),
      tools.query<VoteData>('votes', { where: { roomId }, limit: 500 }),
    ])
    if (!locationsResult.success) return locationsResult
    if (!votesResult.success) return votesResult
    if (
      locationsResult.data.count > locationsResult.data.records.length ||
      votesResult.data.count > votesResult.data.records.length
    ) {
      return failure('Could not verify location votes for this room.')
    }

    const locationIds = new Set(locationsResult.data.records.map((location) => location.recordId))
    if (!votesResult.data.records.some((vote) => locationIds.has(vote.data.optionId))) {
      return failure('At least one location must have a vote before the room can be closed.')
    }

    return tools.update<RoomData>('rooms', roomId, { status: 'closed' })
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
