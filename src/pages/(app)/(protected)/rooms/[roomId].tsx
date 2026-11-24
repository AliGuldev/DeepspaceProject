import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useQuery, useUser } from 'deepspace'
import { ArrowLeft, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  Modal,
  Textarea,
  useToast,
  ConfirmModal,
} from '@/components/ui'

interface Room {
  title: string
  description?: string
  status: 'open' | 'closed'
  ownerId: string
}

interface Option {
  roomId: string
  title: string
  pros: string[]
  cons: string[]
  addedBy: string
}

interface Vote {
  roomId: string
  optionId: string
  userId: string
  value: number
}

type OptionRecord = {
  recordId: string
  data: Option
}

type RoomRecord = {
  recordId: string
  data: Room
}

interface OptionModalProps {
  isOpen: boolean
  option: OptionRecord | null
  onClose: () => void
  onSave: (title: string, pros: string[], cons: string[]) => Promise<boolean>
}

function OptionModal({ isOpen, option, onClose, onSave }: OptionModalProps) {
  const [title, setTitle] = useState(option?.data.title ?? '')
  const [pros, setPros] = useState(option?.data.pros.join('\n') ?? '')
  const [cons, setCons] = useState(option?.data.cons.join('\n') ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setTitle(option?.data.title ?? '')
    setPros(option?.data.pros.join('\n') ?? '')
    setCons(option?.data.cons.join('\n') ?? '')
  }, [isOpen, option?.recordId])

  const handleSubmit = async () => {
    const nextTitle = title.trim()
    if (!nextTitle || saving) return

    setSaving(true)
    try {
      const splitLines = (value: string) =>
        value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      if (await onSave(nextTitle, splitLines(pros), splitLines(cons))) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={saving ? () => undefined : onClose} size="md">
      <Modal.Header>
        <Modal.Title>{option ? 'Edit Option' : 'Add an Option'}</Modal.Title>
        <Modal.Description>Enter one pro or con per line.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div>
            <Label htmlFor="option-title" className="mb-2 block">
              Title
            </Label>
            <Input
              id="option-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter option title"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="option-pros" className="mb-2 block">
              Pros
            </Label>
            <Textarea
              id="option-pros"
              value={pros}
              onChange={(event) => setPros(event.target.value)}
              placeholder="One pro per line"
              rows={4}
              className="resize-y"
            />
          </div>
          <div>
            <Label htmlFor="option-cons" className="mb-2 block">
              Cons
            </Label>
            <Textarea
              id="option-cons"
              value={cons}
              onChange={(event) => setCons(event.target.value)}
              placeholder="One con per line"
              rows={4}
              className="resize-y"
            />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={!title.trim()} loading={saving}>
          {option ? 'Save changes' : 'Add Option'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

interface OptionCardProps {
  option: OptionRecord
  approvals: number
  vetoes: number
  myVote: number | undefined
  canManage: boolean
  isOpen: boolean
  isVoting: boolean
  votingValue?: 1 | -1
  onVote: (value: 1 | -1) => void
  onEdit: () => void
  onDelete: () => void
}

function OptionCard({
  option,
  approvals,
  vetoes,
  myVote,
  canManage,
  isOpen,
  isVoting,
  votingValue,
  onVote,
  onEdit,
  onDelete,
}: OptionCardProps) {
  return (
    <article className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-foreground">{option.data.title}</h3>
            {myVote === 1 && <Badge variant="success" size="sm">Your approve</Badge>}
            {myVote === -1 && <Badge variant="warning" size="sm">Your veto</Badge>}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={onEdit}
              aria-label={`Edit ${option.data.title}`}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              onClick={onDelete}
              aria-label={`Delete ${option.data.title}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-sm font-medium text-foreground">Pros</h4>
          {option.data.pros.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {option.data.pros.map((pro, index) => <li key={`${index}-${pro}`}>{pro}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None added</p>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-sm font-medium text-foreground">Cons</h4>
          {option.data.cons.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {option.data.cons.map((con, index) => <li key={`${index}-${con}`}>{con}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None added</p>
          )}
        </div>
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
  const [editTarget, setEditTarget] = useState<OptionRecord | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OptionRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingVote, setPendingVote] = useState<{ optionId: string; value: 1 | -1 } | null>(null)

  const { records: rooms, status: roomsStatus } = useQuery<Room>('rooms')
  const { records: options, status: optionsStatus } = useQuery<Option>('options', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
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

  const handleSaveOption = async (
    title: string,
    pros: string[],
    cons: string[],
  ): Promise<boolean> => {
    try {
      await callAction(editTarget ? 'updateRoomOption' : 'createRoomOption', {
        ...(editTarget ? { optionId: editTarget.recordId } : { roomId }),
        title,
        pros,
        cons,
      })
      toast.success(editTarget ? 'Option updated' : 'Option added', `"${title}" was saved.`)
      return true
    } catch (error) {
      toast.error(
        editTarget ? 'Could not update option' : 'Could not add option',
        error instanceof Error ? error.message : 'Please try again.',
      )
      return false
    }
  }

  const handleDeleteOption = async () => {
    if (!deleteTarget || deleting) return

    setDeleting(true)
    try {
      await callAction('deleteRoomOption', { optionId: deleteTarget.recordId })
      toast.success('Option deleted', `"${deleteTarget.data.title}" was deleted.`)
      setDeleteTarget(null)
    } catch (error) {
      toast.error(
        'Could not delete option',
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
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus aria-hidden="true" />
                  Add Option
                </Button>
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
        ) : options.length === 0 ? (
          <EmptyState
            title="No options yet"
            description={isOpen ? 'Add the first option for this room.' : 'This room has no options.'}
            action={isOpen ? { label: 'Add option', onClick: () => setShowCreateModal(true) } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {options.map((option) => {
              const totals = voteTotals.get(option.recordId)
              const canManage =
                option.data.addedBy === user?.id || room.data.ownerId === user?.id

              return (
                <OptionCard
                  key={option.recordId}
                  option={option}
                  approvals={totals?.approvals ?? 0}
                  vetoes={totals?.vetoes ?? 0}
                  myVote={totals?.myVote}
                  canManage={canManage}
                  isOpen={isOpen}
                  isVoting={pendingVote?.optionId === option.recordId}
                  votingValue={
                    pendingVote?.optionId === option.recordId ? pendingVote.value : undefined
                  }
                  onVote={(value) => void handleVote(option.recordId, value)}
                  onEdit={() => setEditTarget(option)}
                  onDelete={() => setDeleteTarget(option)}
                />
              )
            })}
          </div>
        )}
      </main>

      <OptionModal
        key={editTarget?.recordId ?? 'create'}
        isOpen={showCreateModal || editTarget !== null}
        option={editTarget}
        onClose={() => {
          setShowCreateModal(false)
          setEditTarget(null)
        }}
        onSave={handleSaveOption}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void handleDeleteOption()}
        title={deleteTarget ? `Delete "${deleteTarget.data.title}"?` : 'Delete option?'}
        description="This cannot be undone."
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  )
}
