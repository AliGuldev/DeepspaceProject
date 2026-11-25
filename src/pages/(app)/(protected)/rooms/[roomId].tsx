import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useQuery, useUser } from 'deepspace'
import {
  ArrowLeft,
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
  useToast,
  ConfirmModal,
} from '@/components/ui'

interface Room {
  title: string
  description?: string
  status: 'open' | 'closed'
  ownerId: string
}

interface Location {
  roomId: string
  kind: 'option' | 'location'
  title: string
  addedBy: string
}

interface Vote {
  roomId: string
  optionId: string
  userId: string
  value: number
}

type LocationRecord = {
  recordId: string
  data: Location
}

type RoomRecord = {
  recordId: string
  data: Room
}

interface LocationModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (location: string) => Promise<boolean>
}

function LocationModal({ isOpen, onClose, onAdd }: LocationModalProps) {
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setLocation('')
  }, [isOpen])

  const handleSubmit = async () => {
    const nextLocation = location.trim()
    if (!nextLocation || saving) return

    setSaving(true)
    try {
      if (await onAdd(nextLocation)) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={saving ? () => undefined : onClose} size="sm">
      <Modal.Header>
        <Modal.Title>Add your location</Modal.Title>
        <Modal.Description>Enter a place name or address for members to vote on.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <Label htmlFor="room-location" className="mb-2 block">
          Location
        </Label>
        <Input
          id="room-location"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="City, address, or place name"
          autoFocus
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!location.trim()} loading={saving}>
          Add location
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

interface LocationCardProps {
  location: LocationRecord
  approvals: number
  vetoes: number
  myVote: number | undefined
  canManage: boolean
  isOpen: boolean
  isVoting: boolean
  votingValue?: 1 | -1
  onVote: (value: 1 | -1) => void
  onDelete: () => void
}

function LocationCard({
  location,
  approvals,
  vetoes,
  myVote,
  canManage,
  isOpen,
  isVoting,
  votingValue,
  onVote,
  onDelete,
}: LocationCardProps) {
  return (
    <article className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-foreground">{location.data.title}</h3>
            {myVote === 1 && <Badge variant="success" size="sm">Your approve</Badge>}
            {myVote === -1 && <Badge variant="warning" size="sm">Your veto</Badge>}
          </div>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${location.data.title}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {isOpen ? (
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
    </article>
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function callAction(name: string, params: Record<string, unknown>): Promise<void> {
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
}

interface RoomDetailPageProps {
  className?: string
}

export default function RoomDetailPage({ className }: RoomDetailPageProps) {
  const { roomId: routeRoomId } = useParams()
  const roomId = routeRoomId ?? ''
  const { user } = useUser()
  const toast = useToast()
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LocationRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingVote, setPendingVote] = useState<{ optionId: string; value: 1 | -1 } | null>(null)

  const { records: rooms, status: roomsStatus } = useQuery<Room>('rooms')
  const { records: optionRecords, status: optionsStatus } = useQuery<Location>('options', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const locations = optionRecords.filter((option) => option.data.kind === 'location')
  const { records: votes, status: votesStatus } = useQuery<Vote>('votes', {
    where: { roomId },
  })

  const room = rooms.find((candidate) => candidate.recordId === roomId)
  const isOpen = room?.data.status === 'open'
  const isLoading =
    roomsStatus === 'loading' || optionsStatus === 'loading' || votesStatus === 'loading'
  const hasError =
    roomsStatus === 'error' || optionsStatus === 'error' || votesStatus === 'error'

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
  const handleAddLocation = async (location: string): Promise<boolean> => {
    try {
      await callAction('addRoomLocation', {
        roomId,
        title: location,
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

  const handleDeleteLocation = async () => {
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
              {isOpen && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setShowLocationModal(true)}>
                    <MapPin aria-hidden="true" />
                    Add location
                  </Button>
                  <Button
                    variant="outline"
                    disabled
                    title="Location detection is not available yet."
                  >
                    <LocateFixed aria-hidden="true" />
                    Use my location (coming soon)
                  </Button>
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
        ) : locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            description={isOpen ? 'Add the first location for members to vote on.' : 'This room has no locations.'}
            action={isOpen ? { label: 'Add location', onClick: () => setShowLocationModal(true) } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {locations.map((location) => {
              const totals = voteTotals.get(location.recordId)
              const canManage =
                location.data.addedBy === user?.id || room.data.ownerId === user?.id

              return (
                <LocationCard
                  key={location.recordId}
                  location={location}
                  approvals={totals?.approvals ?? 0}
                  vetoes={totals?.vetoes ?? 0}
                  myVote={totals?.myVote}
                  canManage={canManage}
                  isOpen={isOpen}
                  isVoting={pendingVote?.optionId === location.recordId}
                  votingValue={
                    pendingVote?.optionId === location.recordId ? pendingVote.value : undefined
                  }
                  onVote={(value) => void handleVote(location.recordId, value)}
                  onDelete={() => setDeleteTarget(location)}
                />
              )
            })}
          </div>
        )}
      </main>

      <LocationModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onAdd={handleAddLocation}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void handleDeleteLocation()}
        title={deleteTarget ? `Delete "${deleteTarget.data.title}"?` : 'Delete location?'}
        description="This location will be removed. This cannot be undone."
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  )
}
