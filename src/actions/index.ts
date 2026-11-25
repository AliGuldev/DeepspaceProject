import type { ActionHandler, ActionTools } from 'deepspace/worker'
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

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const failure = (error: string) => ({ success: false as const, error })

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
