// Section 8.3 security rules, expressed as types so both the game engine
// and the frontend route guards share one vocabulary instead of comparing
// magic strings independently.

export type EventStaffRole = "moderator" | "admin";
export type TeamMemberRole = "leader" | "member";

// Resolved once per request from (participantId, eventId): who is this
// person, for this event, and what may they do. This is what
// team-service.getParticipantContext returns — never trust a client-sent
// version of this.
export interface ParticipantEventContext {
  participantId: string;
  eventId: string;
  staffRole: EventStaffRole | null;
  team: {
    teamId: string;
    role: TeamMemberRole;
  } | null;
}

export function isStaff(ctx: ParticipantEventContext): boolean {
  return ctx.staffRole !== null;
}

export function isTeamLeaderOf(ctx: ParticipantEventContext, teamId: string): boolean {
  return ctx.team?.role === "leader" && ctx.team.teamId === teamId;
}
