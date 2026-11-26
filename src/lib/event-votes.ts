export interface EventVoteTarget {
  locationId: string
  title: string
  url: string | null
  eventDate: string
}

export function getEventVoteOptionId(roomId: string, event: EventVoteTarget): string {
  const identity = event.url
    ? `url:${event.url}:${event.eventDate}`
    : `details:${event.title.trim().toLocaleLowerCase('en-US')}:${event.eventDate}`
  return `event:${roomId}:${event.locationId}:${identity}`
}
