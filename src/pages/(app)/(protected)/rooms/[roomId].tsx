import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useQuery, useUser, useUsers, type RoomUser } from 'deepspace'
import {
  ArrowLeft,
  ChevronDown,
  LocateFixed,
  MapPin,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
  ConfirmModal,
} from '@/components/ui'
import { PLACE_TYPES, type PlaceType } from '@/schemas/options-schema'

interface Room {
  title: string
  description?: string
  status: 'open' | 'closed'
  ownerId: string
}

interface Candidate {
  roomId: string
  kind: 'option' | 'date' | 'location'
  title: string
  placeType?: PlaceType
  addedBy: string
}

interface Vote {
  roomId: string
  optionId: string
  userId: string
  value: number
}

interface LocationWeather {
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

interface RoomEvent {
  title: string
  url: string | null
  eventDate: string
  summary: string | null
}

interface LocationEventResult {
  locationId: string
  events: RoomEvent[]
  error?: string
  warning?: string
  skipped?: boolean
}

interface RoomWeather {
  selectedDateId: string
  selectedDate: string
  locations: LocationWeather[]
  events: LocationEventResult[]
}

function EventCards({ events }: { events: RoomEvent[] }) {
  return (
    <ul className="mt-3 space-y-3">
      {events.map((event, index) => {
        const summary = event.summary
          ?.replace(/\s*\bDATE\W{0,4}\s*unknown\b[.,;:]?/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim()

        return (
          <li key={`${event.title}-${index}`} className="text-sm">
            {event.url ? (
              <a href={event.url} target="_blank" rel="noreferrer" className="font-medium underline">
                {event.title}
              </a>
            ) : (
              <p className="font-medium">{event.title}</p>
            )}
            {summary && (
              <p className="mt-1 text-muted-foreground">{summary}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type CandidateRecord = {
  recordId: string
  data: Candidate
}

type RoomRecord = {
  recordId: string
  data: Room
}

interface LocationModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (location: string, placeType: PlaceType) => Promise<boolean>
  onUseCurrentLocation: (placeType: PlaceType) => Promise<boolean>
}

interface DateModalProps {
  isOpen: boolean
  initialDate?: string
  onClose: () => void
  onAdd: (date: string) => Promise<boolean>
}

function DateModal({ isOpen, initialDate, onClose, onAdd }: DateModalProps) {
  const [date, setDate] = useState(initialDate ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setDate(initialDate ?? '')
  }, [isOpen, initialDate])

  const handleSubmit = async () => {
    if (!date || saving) return

    setSaving(true)
    try {
      if (await onAdd(date)) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={saving ? () => undefined : onClose} size="sm">
      <Modal.Header>
        <Modal.Title>{initialDate ? 'Update your date' : 'Add your date'}</Modal.Title>
        <Modal.Description>Each member adds one date for the group to consider.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <Label htmlFor="room-date" className="mb-2 block">
          Date
        </Label>
        <Input
          id="room-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          autoFocus
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!date} loading={saving}>
          {initialDate ? 'Update date' : 'Add date'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function LocationModal({ isOpen, onClose, onAdd, onUseCurrentLocation }: LocationModalProps) {
  const [location, setLocation] = useState('')
  const [placeType, setPlaceType] = useState<PlaceType | ''>('')
  const [savingMode, setSavingMode] = useState<'manual' | 'current' | null>(null)
  const saving = savingMode !== null

  useEffect(() => {
    if (isOpen) {
      setLocation('')
      setPlaceType('')
    }
  }, [isOpen])

  const handleSubmit = async () => {
    const nextLocation = location.trim()
    if (!nextLocation || !placeType || saving) return

    setSavingMode('manual')
    try {
      if (await onAdd(nextLocation, placeType)) onClose()
    } finally {
      setSavingMode(null)
    }
  }

  const handleUseCurrentLocation = async () => {
    if (!placeType || saving) return

    setSavingMode('current')
    try {
      if (await onUseCurrentLocation(placeType)) onClose()
    } finally {
      setSavingMode(null)
    }
  }

  return (
    <Modal open={isOpen} onClose={saving ? () => undefined : onClose} size="sm">
      <Modal.Header>
        <Modal.Title>Add a place</Modal.Title>
        <Modal.Description>Choose a place type, then enter a location or use your current location.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div>
            <Label htmlFor="place-type" className="mb-2 block">
              Type of place
            </Label>
            <Select
              value={placeType}
              onValueChange={(value) =>
                setPlaceType(PLACE_TYPES.find((placeTypeOption) => placeTypeOption === value) ?? '')
              }
              disabled={saving}
            >
              <SelectTrigger id="place-type">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {PLACE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="room-location" className="mb-2 block">
              Location
            </Label>
            <Input
              id="room-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="City, address, or place name"
              autoFocus
              disabled={saving}
            />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleUseCurrentLocation()}
          disabled={!placeType || saving}
          loading={savingMode === 'current'}
        >
          <LocateFixed aria-hidden="true" />
          Use my location
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          disabled={!location.trim() || !placeType || saving}
          loading={savingMode === 'manual'}
        >
          Add location
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

interface CandidateCardProps {
  candidate: CandidateRecord
  approvals: number
  vetoes: number
  myVote: number | undefined
  canDelete: boolean
  allowVoting: boolean
  isVoting: boolean
  isSelected?: boolean
  weather?: LocationWeather
  weatherLoading?: boolean
  events?: LocationEventResult
  eventsLoading?: boolean
  votingValue?: 1 | -1
  onVote: (value: 1 | -1) => void
  onDelete?: () => void
  onRetryEvents?: () => void
}

function CandidateCard({
  candidate,
  approvals,
  vetoes,
  myVote,
  canDelete,
  allowVoting,
  isVoting,
  isSelected = false,
  weather,
  weatherLoading,
  events,
  eventsLoading,
  votingValue,
  onVote,
  onDelete,
  onRetryEvents,
}: CandidateCardProps) {
  const placeType = PLACE_TYPES.find((type) => type === candidate.data.placeType)
  const isLocation = candidate.data.kind === 'location'
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = `location-details-${candidate.recordId}`
  const title =
    candidate.data.kind === 'date'
      ? new Date(`${candidate.data.title}T00:00:00`).toLocaleDateString()
      : candidate.data.title

  return (
    <article className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isLocation ? (
            <button
              type="button"
              className="flex w-full cursor-pointer items-start justify-between gap-3 text-left"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-foreground">{title}</h3>
                  {myVote === 1 && <Badge variant="success" size="sm">Your approve</Badge>}
                  {myVote === -1 && <Badge variant="warning" size="sm">Your veto</Badge>}
                  {placeType && (
                    <Badge variant="secondary" size="sm">
                      {placeType}
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronDown
                className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-foreground">{title}</h3>
              {isSelected && <Badge variant="default" size="sm">Selected date</Badge>}
              {myVote === 1 && <Badge variant="success" size="sm">Your approve</Badge>}
              {myVote === -1 && <Badge variant="warning" size="sm">Your veto</Badge>}
            </div>
          )}
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${candidate.data.title}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>

      <div id={isLocation ? detailsId : undefined} hidden={isLocation && !isExpanded}>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {allowVoting ? (
            <>
              <Button
                variant={myVote === 1 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => onVote(1)}
                loading={isVoting && votingValue === 1}
                disabled={isVoting}
              >
                {!isVoting && <ThumbsUp aria-hidden="true" />}
                Approve ({approvals})
              </Button>
              <Button
                variant={myVote === -1 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => onVote(-1)}
                loading={isVoting && votingValue === -1}
                disabled={isVoting}
              >
                {!isVoting && <ThumbsDown aria-hidden="true" />}
                Veto ({vetoes})
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {approvals} approvals | {vetoes} vetoes
            </span>
          )}
        </div>
        {isLocation && (
          <>
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="text-sm font-medium text-foreground">Weather</h4>
              {weatherLoading ? (
                <p className="mt-1 text-sm text-muted-foreground">Loading Open-Meteo weather…</p>
              ) : weather?.error ? (
                <p className="mt-1 text-sm text-muted-foreground">{weather.error}</p>
              ) : weather ? (
                <>
                  {weather.resolvedPlace && (
                    <p className="mt-1 text-sm text-muted-foreground">{weather.resolvedPlace}</p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {weather.condition ?? 'Conditions unavailable'}
                    {weather.temperatureMin !== null && ` · Low ${weather.temperatureMin}°C`}
                    {weather.temperatureMax !== null && ` · High ${weather.temperatureMax}°C`}
                    {weather.precipitation !== null &&
                      ` · ${weather.precipitationKind === 'probability' ? 'Chance of precipitation' : 'Precipitation total'} ${weather.precipitation}${weather.precipitationUnit ?? ''}`}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Weather is not loaded yet.</p>
              )}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="text-sm font-medium text-foreground">Events</h4>
              {eventsLoading ? (
                <p className="mt-1 text-sm text-muted-foreground">Searching events…</p>
              ) : events?.skipped ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Event searches are limited to the first 10 locations.
                </p>
              ) : events?.error ? (
                <>
                  <p role="alert" className="mt-1 text-sm text-destructive">{events.error}</p>
                  <button
                    type="button"
                    className="mt-2 text-sm underline disabled:opacity-50"
                    onClick={onRetryEvents}
                  >
                    Retry event search
                  </button>
                </>
              ) : events ? (
                <>
                  {events.events.length > 0 ? (
                    <EventCards events={events.events} />
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">No events matched this location.</p>
                  )}
                  {events.warning && (
                    <p role="alert" className="mt-2 text-sm text-destructive">{events.warning}</p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Event searches start when at least two locations are available.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in and try again.')

  const response = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isObject(payload) || payload.success !== true) {
    const message = isObject(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Please try again.'
    throw new Error(message)
  }
  return payload.data as T
}

function getCurrentCoordinates(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is unavailable. Use a secure connection and a supported browser.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        const message =
          error.code === 1
            ? 'Allow location access in your browser and try again.'
            : error.code === 3
              ? 'Location lookup timed out. Please try again.'
              : 'Your current location could not be determined.'
        reject(new Error(message))
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    )
  })
}

interface RoomDetailPageProps {
  className?: string
}

export default function RoomDetailPage({ className }: RoomDetailPageProps) {
  const { roomId: routeRoomId } = useParams()
  const roomId = routeRoomId ?? ''
  const { user } = useUser()
  const { users: roomMembers, usersLoaded } = useUsers()
  const toast = useToast()
  const [showDateModal, setShowDateModal] = useState(false)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [showCloseRoomConfirmation, setShowCloseRoomConfirmation] = useState(false)
  const [weatherData, setWeatherData] = useState<RoomWeather | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [weatherRetry, setWeatherRetry] = useState(0)
  const [closingRoom, setClosingRoom] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CandidateRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingVote, setPendingVote] = useState<{ optionId: string; value: 1 | -1 } | null>(null)

  const { records: rooms, status: roomsStatus } = useQuery<Room>('rooms')
  const { records: candidates, status: optionsStatus } = useQuery<Candidate>('options', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const dates = candidates.filter((candidate) => candidate.data.kind === 'date')
  const locations = candidates.filter((candidate) => candidate.data.kind === 'location')
  const { records: votes, status: votesStatus } = useQuery<Vote>('votes', {
    where: { roomId },
  })
  const locationIds = new Set(locations.map((location) => location.recordId))
  const hasLocationVote = votes.some((vote) => locationIds.has(vote.data.optionId))

  const room = rooms.find((candidate) => candidate.recordId === roomId)
  const isOpen = room?.data.status === 'open'
  const isLoading =
    roomsStatus === 'loading' || optionsStatus === 'loading' || votesStatus === 'loading'
  const hasError =
    roomsStatus === 'error' || optionsStatus === 'error' || votesStatus === 'error'

  const members = useMemo(() => {
    const byId = new Map<string, RoomUser>(roomMembers.map((member) => [member.id, member]))
    if (user && !byId.has(user.id)) {
      byId.set(user.id, { id: user.id, name: user.name || 'You', role: 'member' })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [roomMembers, user])

  const voteTotals = useMemo(() => {
    const totals = new Map<string, { approvals: number; vetoes: number; myVote?: number }>()
    votes.forEach((vote) => {
      const total = totals.get(vote.data.optionId) ?? { approvals: 0, vetoes: 0 }
      if (vote.data.value === 1) total.approvals += 1
      if (vote.data.value === -1) total.vetoes += 1
      if (vote.data.userId === user?.id) total.myVote = vote.data.value
      totals.set(vote.data.optionId, total)
    })
    return totals
  }, [votes, user?.id])
  const dateSubmitters = useMemo(
    () => new Set(dates.map((date) => date.data.addedBy)),
    [dates],
  )
  const dateIds = useMemo(() => new Set(dates.map((date) => date.recordId)), [dates])
  const dateVotes = useMemo(
    () => votes.filter((vote) => dateIds.has(vote.data.optionId)),
    [dateIds, votes],
  )
  const membersSubmittedDates =
    usersLoaded && members.length > 0 && members.every((member) => dateSubmitters.has(member.id))
  const hasVotedDate = dateVotes.length > 0
  const dateStageComplete = membersSubmittedDates && hasVotedDate
  const myDate = dates.find((date) => date.data.addedBy === user?.id)
  const locationSignature = locations.map((location) => location.recordId).join(',')
  const dateVoteSignature = dateVotes
    .map((vote) => `${vote.recordId}:${vote.data.value}`)
    .sort()
    .join(',')

  useEffect(() => {
    if (!dateStageComplete || !locationSignature) {
      setWeatherData(null)
      setWeatherError(null)
      setWeatherLoading(false)
      return
    }

    let active = true
    setWeatherData(null)
    setWeatherLoading(true)
    setWeatherError(null)
    void callAction<RoomWeather>('getRoomWeather', { roomId })
      .then((result) => {
        if (active) setWeatherData(result)
      })
      .catch((error: unknown) => {
        if (active) {
          setWeatherError(
            error instanceof Error ? error.message : 'Weather could not be retrieved.',
          )
        }
      })
      .finally(() => {
        if (active) setWeatherLoading(false)
      })

    return () => {
      active = false
    }
  }, [dateStageComplete, dateVoteSignature, locationSignature, roomId, weatherRetry])

  const weatherByLocationId = useMemo(
    () => new Map(weatherData?.locations?.map((item) => [item.locationId, item]) ?? []),
    [weatherData],
  )
  const eventsByLocationId = useMemo(
    () => new Map(weatherData?.events?.map((result) => [result.locationId, result]) ?? []),
    [weatherData],
  )

  const handleAddDate = async (date: string): Promise<boolean> => {
    try {
      await callAction('addRoomDate', { roomId, title: date })
      toast.success(myDate ? 'Date updated' : 'Date added', `${date} is ready for votes.`)
      return true
    } catch (error) {
      toast.error(
        'Could not save date',
        error instanceof Error ? error.message : 'Please try again.',
      )
      return false
    }
  }

  const handleAddLocation = async (location: string, placeType: PlaceType): Promise<boolean> => {
    try {
      await callAction('addRoomLocation', {
        roomId,
        title: location,
        placeType,
      })
      toast.success('Location added', `"${location}" is ready for votes.`)
      return true
    } catch (error) {
      toast.error(
        'Could not add location',
        error instanceof Error ? error.message : 'Please try again.',
      )
      return false
    }
  }

  const handleUseMyLocation = async (placeType: PlaceType): Promise<boolean> => {
    try {
      const coordinates = await getCurrentCoordinates()
      await callAction('addRoomLocation', { roomId, ...coordinates, placeType })
      toast.success('Location added', 'Your current location is ready for votes.')
      return true
    } catch (error) {
      toast.error(
        'Could not use your location',
        error instanceof Error ? error.message : 'Please try again.',
      )
      return false
    }
  }

  const handleCloseRoom = async () => {
    if (closingRoom) return

    setClosingRoom(true)
    try {
      await callAction('closeRoom', { roomId })
      setShowCloseRoomConfirmation(false)
      toast.success('Room closed', 'Voting is now complete.')
    } catch (error) {
      toast.error(
        'Could not close room',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setClosingRoom(false)
    }
  }

  const handleDeleteCandidate = async () => {
    if (!deleteTarget || deleting) return

    setDeleting(true)
    try {
      await callAction('deleteRoomLocation', { optionId: deleteTarget.recordId })
      toast.success('Location deleted', `"${deleteTarget.data.title}" was deleted.`)
      setDeleteTarget(null)
    } catch (error) {
      toast.error(
        'Could not delete location',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setDeleting(false)
    }
  }

  const handleVote = async (optionId: string, value: 1 | -1) => {
    if (pendingVote || !isOpen) return

    setPendingVote({ optionId, value })
    try {
      await callAction('castRoomVote', { roomId, optionId, value })
      toast.success('Vote saved', value === 1 ? 'Your approval was recorded.' : 'Your veto was recorded.')
    } catch (error) {
      toast.error('Could not save vote', error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setPendingVote(null)
    }
  }

  return (
    <div className={`h-full overflow-y-auto bg-background ${className ?? ''}`}>
      <div className="sticky top-0 z-10 border-b border-border bg-card/60 backdrop-blur-md">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/rooms" className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" />
            All rooms
          </Link>
          {room && (
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-foreground">{room.data.title}</h1>
                  <Badge variant={isOpen ? 'success' : 'secondary'} size="sm">
                    {isOpen ? 'Open' : 'Closed'}
                  </Badge>
                </div>
                {room.data.description && (
                  <p className="mt-1 text-muted-foreground">{room.data.description}</p>
                )}
              </div>
              {isOpen && dateStageComplete && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setShowLocationModal(true)}>
                    <MapPin aria-hidden="true" />
                    Add location
                  </Button>
                  {room.data.ownerId === user?.id && hasLocationVote && (
                    <Button
                      variant="destructive"
                      onClick={() => setShowCloseRoomConfirmation(true)}
                    >
                      Close room
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="grid gap-4" aria-label="Loading room" aria-busy="true">
            <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
            <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
          </div>
        ) : hasError ? (
          <EmptyState title="Could not load this room" description="Refresh the page and try again." />
        ) : !room ? (
          <EmptyState title="Room not found" description="It may have been removed." />
        ) : (
          <div className="space-y-8">
            <section className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">1. Choose a date</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Every member adds one date. Locations unlock after everyone has added a date
                    and at least one date has a vote.
                  </p>
                </div>
                {isOpen && !dateStageComplete && (
                  <Button variant="secondary" onClick={() => setShowDateModal(true)}>
                    {myDate ? 'Update my date' : 'Add my date'}
                  </Button>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4">
                <h3 className="mb-3 font-medium text-foreground">Member participation</h3>
                {!usersLoaded ? (
                  <p className="text-sm text-muted-foreground">Loading members…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members found.</p>
                ) : (
                  <ul className="space-y-3">
                    {members.map((member) => {
                      const hasDate = dateSubmitters.has(member.id)
                      const hasVoted = dateVotes.some((vote) => vote.data.userId === member.id)
                      return (
                        <li
                          key={member.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span className="font-medium text-foreground">{member.name}</span>
                          <span className="flex flex-wrap gap-2">
                            <Badge variant={hasDate ? 'success' : 'warning'} size="sm">
                              {hasDate ? 'Date added' : 'Needs date'}
                            </Badge>
                            <Badge variant={hasVoted ? 'success' : 'warning'} size="sm">
                              {hasVoted ? 'Voted' : 'Needs to vote'}
                            </Badge>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {dates.length === 0 ? (
                <EmptyState
                  title="No dates yet"
                  description={isOpen ? 'Add your date to get the group started.' : 'This room has no dates.'}
                />
              ) : (
                <div className="space-y-3">
                  {dates.map((date) => {
                    const totals = voteTotals.get(date.recordId)
                    return (
                      <CandidateCard
                        key={date.recordId}
                        candidate={date}
                        approvals={totals?.approvals ?? 0}
                        vetoes={totals?.vetoes ?? 0}
                        myVote={totals?.myVote}
                        canDelete={false}
                        allowVoting={isOpen}
                        isSelected={weatherData?.selectedDateId === date.recordId}
                        isVoting={pendingVote?.optionId === date.recordId}
                        votingValue={
                          pendingVote?.optionId === date.recordId ? pendingVote.value : undefined
                        }
                        onVote={(value) => void handleVote(date.recordId, value)}
                      />
                    )
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">2. Choose a location</h2>
                {!dateStageComplete && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Locations unlock when every member has added a date and at least one date has
                    been voted on.
                  </p>
                )}
                {weatherData && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Weather for {new Date(`${weatherData.selectedDate}T00:00:00`).toLocaleDateString()}.
                    The date is selected by approvals, then fewer vetoes, then earliest submission.
                  </p>
                )}
              </div>

              {!dateStageComplete ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Waiting for the date stage to finish.
                </div>
              ) : (
                <>
                  {weatherError && (
                    <p role="alert" className="text-sm text-destructive">
                      {weatherError}
                    </p>
                  )}
                  {locations.length === 0 ? (
                    <EmptyState
                      title="No locations yet"
                      description={isOpen ? 'Add the first location for members to vote on.' : 'This room has no locations.'}
                    />
                  ) : (
                    <div className="space-y-3">
                      {locations.map((location) => {
                        const totals = voteTotals.get(location.recordId)
                        const canDelete =
                          isOpen &&
                          (location.data.addedBy === user?.id || room.data.ownerId === user?.id)
                        return (
                          <CandidateCard
                            key={location.recordId}
                            candidate={location}
                            approvals={totals?.approvals ?? 0}
                            vetoes={totals?.vetoes ?? 0}
                            myVote={totals?.myVote}
                            canDelete={canDelete}
                            allowVoting={isOpen}
                            isVoting={pendingVote?.optionId === location.recordId}
                            weather={weatherByLocationId.get(location.recordId)}
                            weatherLoading={weatherLoading}
                            events={eventsByLocationId.get(location.recordId)}
                            eventsLoading={weatherLoading && locations.length >= 2}
                            votingValue={
                              pendingVote?.optionId === location.recordId
                                ? pendingVote.value
                                : undefined
                            }
                            onVote={(value) => void handleVote(location.recordId, value)}
                            onDelete={() => setDeleteTarget(location)}
                            onRetryEvents={() => setWeatherRetry((retry) => retry + 1)}
                          />
                        )
                      })}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Weather data by{' '}
                    <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">
                      Open-Meteo
                    </a>
                    {' · '}Geocoding by{' '}
                    <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline">
                      Geoapify
                    </a>
                    {' · '}Events by{' '}
                    <a href="https://exa.ai/" target="_blank" rel="noreferrer" className="underline">
                      Exa
                    </a>
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </main>

      <DateModal
        isOpen={showDateModal}
        initialDate={myDate?.data.title}
        onClose={() => setShowDateModal(false)}
        onAdd={handleAddDate}
      />

      <LocationModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onAdd={handleAddLocation}
        onUseCurrentLocation={handleUseMyLocation}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void handleDeleteCandidate()}
        title={deleteTarget ? `Delete "${deleteTarget.data.title}"?` : 'Delete location?'}
        description="This location will be removed. This cannot be undone."
        confirmText="Delete"
        loading={deleting}
      />

      <ConfirmModal
        open={showCloseRoomConfirmation}
        onClose={() => {
          if (!closingRoom) setShowCloseRoomConfirmation(false)
        }}
        onConfirm={() => void handleCloseRoom()}
        title="Close this room?"
        description="Voting will stop and locations can no longer be changed. This cannot be undone."
        confirmText="Close room"
        loading={closingRoom}
      />
    </div>
  )
}
