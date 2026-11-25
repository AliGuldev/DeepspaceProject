import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

interface RoomData extends Record<string, unknown> {
  status: string
  ownerId: string
}

interface OptionData extends Record<string, unknown> {
  roomId: string
  kind: 'option' | 'location'
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

export const actions: Record<string, ActionHandler<Env>> = {
  addRoomLocation: async ({ userId, params, tools }) => {
    const roomId = requiredString(params.roomId)
    const title = requiredString(params.title)
    if (!roomId || !title) return failure('Room and location are required.')

    const roomResult = await tools.get<RoomData>('rooms', roomId)
    if (!roomResult.success) return failure('Room not found.')
    if (roomResult.data.record.data.status !== 'open') {
      return failure('Locations can only be added to an open room.')
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
    if (
      !optionResult.success ||
      optionResult.data.record.data.roomId !== roomId ||
      optionResult.data.record.data.kind !== 'location'
    ) {
      return failure('Location not found in this room.')
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
