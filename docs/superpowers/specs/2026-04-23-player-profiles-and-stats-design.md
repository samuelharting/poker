# Player Profiles and Stats Design

## Goal

Add a lightweight player profile to the existing poker app so returning users can reuse nickname, email, and Venmo username, while the room tracks simple poker stats and displays a winner's Venmo handle after each hand.

## Scope

This is not a production account system. There is no password, OAuth, database, or cross-device account recovery. The browser remembers a local profile, and the live PartyKit room tracks stats while that room instance is active.

## User Flow

The create, join, and direct room entry screens require three fields:

- Nickname
- Email
- Venmo username

The client trims and validates these fields before entering a room. The app saves them in `localStorage` under one profile key so the next visit pre-fills the form. The profile is sent in the existing `join_room` message.

## Data Rules

Email is normalized to lowercase and used as the stable user key for room stats. Email is not shown in public table snapshots. Venmo usernames are sanitized, normalized with a leading `@` for display, and shown in public table snapshots.

Bots do not need email or Venmo. Existing reconnect tokens continue to work, and reconnecting users keep their original profile and stats.

## Stats

PartyKit tracks these room-local stats per normalized email:

- `handsPlayed`
- `folds`
- `wins`
- `totalWon`
- computed `foldRate`

A player is counted as playing a hand when they are dealt in at hand start. A fold increments `folds`. A hand winner increments `wins` and adds the won amount to `totalWon`.

## UI

Winner announcements show the player's Venmo handle next to their name. Player seats and the player management list may show compact stats, but the first version should avoid crowding the table. The minimum UI requirement is:

- Join/create forms collect and remember profile fields.
- Winner center announcement includes Venmo when known.
- Winner payout chip on the seat includes Venmo when known.

## Testing

Add tests before implementation for:

- Protocol parsing accepts a valid profile and rejects invalid email or missing Venmo.
- Room snapshots expose Venmo and stats but not email.
- Folding and winning update the room stats.
- Landing/direct room profile validation and local profile storage helpers work without a browser account backend.
