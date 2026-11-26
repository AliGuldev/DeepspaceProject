import { useMemo } from 'react'
import { CalendarDays, MapPin } from 'lucide-react'
import { useAuthProfileReady, useQuery } from 'deepspace'
import { Link } from 'react-router-dom'
import { Badge, EmptyState } from '@/components/ui'

interface Room {
  title: string
  description?: string
  status: 'open' | 'closed'
}

interface RoomOption {
  roomId: string
  kind: 'option' | 'date' | 'location'
  title: string
}

interface Vote {
  roomId: string
  optionId: string
  value: number
}

type RoomRecord = {
  recordId: string
  data: Room
}

type RoomOptionRecord = {
  recordId: string
  data: RoomOption
  createdAt: string
}

type VoteRecord = {
  data: Vote
}

function rankOptions(options: RoomOptionRecord[], votes: VoteRecord[]) {
  const totals = new Map<string, { approvals: number; vetoes: number }>()
  for (const option of options) totals.set(option.recordId, { approvals: 0, vetoes: 0 })
  for (const vote of votes) {
    const total = totals.get(vote.data.optionId)
    if (!total) continue
    if (vote.data.value === 1) total.approvals += 1
    if (vote.data.value === -1) total.vetoes += 1
  }

  return options
    .map((option) => ({
      option,
      ...(totals.get(option.recordId) ?? { approvals: 0, vetoes: 0 }),
    }))
    .sort(
      (left, right) =>
        right.approvals - left.approvals ||
        left.vetoes - right.vetoes ||
        left.option.createdAt.localeCompare(right.option.createdAt),
    )
}

function todayAsIsoDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function formatEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}

export default function HomePage() {
  useAuthProfileReady({ requireUser: true })
  const { records: rooms, status: roomsStatus } = useQuery<Room>('rooms')
  const { records: options, status: optionsStatus } = useQuery<RoomOption>('options')
  const { records: votes, status: votesStatus } = useQuery<Vote>('votes')
  const isLoading =
    roomsStatus === 'loading' || optionsStatus === 'loading' || votesStatus === 'loading'
  const hasError =
    roomsStatus === 'error' || optionsStatus === 'error' || votesStatus === 'error'

  const upcomingEvents = useMemo(() => {
    const today = todayAsIsoDate()
    return rooms.flatMap((room) => {
      if (room.data.status !== 'closed') return []

      const roomOptions = options.filter((option) => option.data.roomId === room.recordId)
      const roomVotes = votes.filter((vote) => vote.data.roomId === room.recordId)
      const selectedDate = rankOptions(
        roomOptions.filter((option) => option.data.kind === 'date'),
        roomVotes,
      )[0]?.option
      const selectedLocation = rankOptions(
        roomOptions.filter((option) => option.data.kind === 'location'),
        roomVotes,
      )[0]?.option

      if (
        !selectedDate ||
        !selectedLocation ||
        !isValidIsoDate(selectedDate.data.title) ||
        selectedDate.data.title < today
      ) {
        return []
      }

      return [{
        room,
        date: selectedDate.data.title,
        location: selectedLocation.data.title,
      }]
    }).sort((left, right) => left.date.localeCompare(right.date))
  }, [options, rooms, votes])

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Upcoming events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Future plans from closed rooms.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading upcoming events" aria-busy="true">
            <div className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />
            <div className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />
          </div>
        ) : hasError ? (
          <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">
            Upcoming events could not be loaded. Refresh the page and try again.
          </p>
        ) : upcomingEvents.length === 0 ? (
          <EmptyState
            title="No upcoming events"
            description="Closed rooms with a future date and location will appear here."
            icon={<CalendarDays aria-hidden="true" />}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {upcomingEvents.map(({ room, date, location }) => (
              <article key={room.recordId} className="rounded-xl border border-border bg-card/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-foreground">
                      <Link
                        to={`/rooms/${encodeURIComponent(room.recordId)}`}
                        className="hover:underline"
                      >
                        {room.data.title}
                      </Link>
                    </h2>
                    {room.data.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {room.data.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" size="sm">Closed</Badge>
                </div>
                <p className="mt-4 flex items-center gap-2 text-sm text-foreground">
                  <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
                  {formatEventDate(date)}
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="size-4" aria-hidden="true" />
                  {location}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
