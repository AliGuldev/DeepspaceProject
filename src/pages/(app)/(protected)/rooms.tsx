import { useEffect, useMemo, useState } from 'react'
import { DoorClosed, DoorOpen, Inbox, Pencil, Plus, Trash2 } from 'lucide-react'
import { ROLES, useMutations, useQuery, useUser, type Role } from 'deepspace'
import { Link, Outlet, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  Modal,
  Textarea,
  useToast,
} from '@/components/ui'
import { callAction } from '@/lib/action-client'

const ROOM_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const

interface Room {
  title: string
  description?: string
  status: 'open' | 'closed'
  ownerId: string
}

type RoomRecord = {
  recordId: string
  data: Room
  createdAt: string
}

interface RoomModalProps {
  isOpen: boolean
  room: RoomRecord | null
  onClose: () => void
  onSave: (title: string, description: string) => Promise<boolean>
}

function RoomModal({ isOpen, room, onClose, onSave }: RoomModalProps) {
  const [title, setTitle] = useState(room?.data.title ?? '')
  const [description, setDescription] = useState(room?.data.description ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setTitle(room?.data.title ?? '')
    setDescription(room?.data.description ?? '')
  }, [isOpen, room?.recordId])

  const handleSubmit = async () => {
    const nextTitle = title.trim()
    if (!nextTitle || saving) return

    setSaving(true)
    try {
      if (await onSave(nextTitle, description.trim())) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={saving ? () => undefined : onClose} size="sm">
      <Modal.Header>
        <Modal.Title>{room ? 'Edit Room' : 'Create Room'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div>
            <Label htmlFor="room-title" className="mb-2 block">
              Title
            </Label>
            <Input
              id="room-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter room title"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="room-description" className="mb-2 block">
              Description
            </Label>
            <Textarea
              id="room-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Enter description (optional)"
              rows={3}
              className="resize-none"
            />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!title.trim()} loading={saving}>
          {room ? 'Save changes' : 'Create'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

interface RoomCardProps {
  room: RoomRecord
  isOwner: boolean
  isUpdating: boolean
  isDeleting: boolean
  onEdit: () => void
  onClose: () => void
  onDelete: () => void
}

function RoomCard({
  room,
  isOwner,
  isUpdating,
  isDeleting,
  onEdit,
  onClose,
  onDelete,
}: RoomCardProps) {
  const isClosed = room.data.status === ROOM_STATUS.CLOSED

  return (
    <div
      className={`rounded-xl border bg-card/60 p-4 ${
        isClosed ? 'border-border/30 opacity-70' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="font-medium text-foreground">
              <Link to={`/rooms/${encodeURIComponent(room.recordId)}`} className="hover:underline">
                {room.data.title}
              </Link>
            </h3>
            <Badge variant={isClosed ? 'secondary' : 'success'} size="sm">
              {isClosed ? 'Closed' : 'Open'}
            </Badge>
          </div>
          {room.data.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{room.data.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Created {new Date(room.createdAt).toLocaleDateString()}
          </p>
        </div>

        {isOwner && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={onEdit}
              disabled={isUpdating || isDeleting}
              aria-label={`Edit ${room.data.title}`}
            >
              <Pencil aria-hidden="true" />
            </Button>
            {!isClosed && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                onClick={onClose}
                loading={isUpdating && !isDeleting}
                disabled={isDeleting}
                aria-label={`Close ${room.data.title}`}
              >
                {!isUpdating && <DoorClosed aria-hidden="true" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              onClick={onDelete}
              disabled={isUpdating || isDeleting}
              loading={isDeleting}
              aria-label={`Delete ${room.data.title}`}
            >
              {!isDeleting && <Trash2 aria-hidden="true" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

interface RoomsPageProps {
  className?: string
}

export default function RoomsPage({ className }: RoomsPageProps) {
  const { roomId: nestedRoomId } = useParams()
  const { user } = useUser()
  const userRole = (user?.role ?? ROLES.VIEWER) as Role
  const canCreate = userRole === ROLES.MEMBER || userRole === ROLES.ADMIN
  const toast = useToast()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editTarget, setEditTarget] = useState<RoomRecord | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RoomRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { records: rooms, status } = useQuery<Room>('rooms', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { createConfirmed, putConfirmed, removeConfirmed } = useMutations<Room>('rooms')

  const { myRooms, otherRooms } = useMemo(() => {
    const mine: typeof rooms = []
    const others: typeof rooms = []

    rooms.forEach((room) => {
      if (room.data.ownerId === user?.id) mine.push(room)
      else others.push(room)
    })

    return { myRooms: mine, otherRooms: others }
  }, [rooms, user?.id])

  const handleSave = async (
    room: RoomRecord | null,
    title: string,
    description: string,
  ): Promise<boolean> => {
    if (!user) {
      toast.error('Could not save room', 'Sign in and try again.')
      return false
    }

    try {
      if (room) {
        await putConfirmed(room.recordId, { title, description })
        toast.success('Room updated', `"${title}" was saved.`)
      } else {
        await createConfirmed({
          title,
          description,
          status: ROOM_STATUS.OPEN,
          ownerId: user.id,
        })
        toast.success('Room created', `"${title}" is ready.`)
      }
      return true
    } catch (error) {
      toast.error(
        room ? 'Could not update room' : 'Could not create room',
        error instanceof Error ? error.message : 'Please try again.',
      )
      return false
    }
  }

  const handleClose = async (room: RoomRecord) => {
    if (updatingId) return

    setUpdatingId(room.recordId)
    try {
      const result = await callAction<{
        emailSent: boolean
        calendarEventCreated: boolean
        warning?: string
      }>(
        'closeRoom',
        { roomId: room.recordId },
      )
      if (result.warning) {
        toast.error('Room closed with an issue', result.warning)
      } else {
        toast.success(
          'Room closed',
          [
            result.emailSent
              ? `"${room.data.title}" is closed and the voting results were emailed.`
              : `"${room.data.title}" is now closed.`,
            result.calendarEventCreated ? 'A Google Calendar event was created.' : undefined,
          ].filter(Boolean).join(' '),
        )
      }
    } catch (error) {
      toast.error(
        'Could not close room',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return

    setDeleting(true)
    try {
      await removeConfirmed(deleteTarget.recordId)
      toast.success('Room deleted', `"${deleteTarget.data.title}" was deleted.`)
      setDeleteTarget(null)
    } catch (error) {
      toast.error(
        'Could not delete room',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setDeleting(false)
    }
  }

  const isLoading = status === 'loading'

  if (nestedRoomId) return <Outlet />

  return (
    <div className={`h-full overflow-y-auto bg-background ${className ?? ''}`}>
      <div className="sticky top-0 z-10 border-b border-border bg-card/60 backdrop-blur-md">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Rooms</h1>
              <p className="mt-1 text-muted-foreground">
                {isLoading
                  ? 'Loading rooms...'
                  : `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} in this workspace`}
              </p>
            </div>
            {canCreate && (
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus aria-hidden="true" />
                New Room
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading rooms" aria-busy="true">
            <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />
            <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState
            title="No rooms yet"
            description={
              canCreate ? 'Create your first room to get started.' : 'No rooms have been created yet.'
            }
            icon={<DoorOpen aria-hidden="true" />}
            action={
              canCreate ? { label: 'New room', onClick: () => setShowCreateModal(true) } : undefined
            }
          />
        ) : (
          <div className="space-y-8">
            {myRooms.length > 0 && (
              <section>
                <h2 className="mb-4 text-lg font-semibold text-foreground">My Rooms</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {myRooms.map((room) => (
                    <RoomCard
                      key={room.recordId}
                      room={room}
                      isOwner
                      isUpdating={updatingId === room.recordId}
                      isDeleting={deleting && deleteTarget?.recordId === room.recordId}
                      onEdit={() => setEditTarget(room)}
                      onClose={() => void handleClose(room)}
                      onDelete={() => setDeleteTarget(room)}
                    />
                  ))}
                </div>
              </section>
            )}

            {otherRooms.length > 0 && (
              <section>
                <h2 className="mb-4 text-lg font-semibold text-foreground">Other Rooms</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {otherRooms.map((room) => (
                    <RoomCard
                      key={room.recordId}
                      room={room}
                      isOwner={false}
                      isUpdating={false}
                      isDeleting={false}
                      onEdit={() => undefined}
                      onClose={() => undefined}
                      onDelete={() => undefined}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <RoomModal
        key={editTarget?.recordId ?? 'create'}
        isOpen={showCreateModal || editTarget !== null}
        room={editTarget}
        onClose={() => {
          setShowCreateModal(false)
          setEditTarget(null)
        }}
        onSave={(title, description) => handleSave(editTarget, title, description)}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void handleDelete()}
        title={deleteTarget ? `Delete "${deleteTarget.data.title}"?` : 'Delete room?'}
        description="This cannot be undone."
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  )
}
