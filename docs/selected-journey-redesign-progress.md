# Selected Journey Redesign Progress

## Scope requested
- Improve readability for humans.
- Remove Lead and Scheduled Call bubbles.
- Keep attribution confidence in Ad Click bubble.
- Add key data in Selected Journey: user, attribution certainty, ad source, landing page, post-click events.
- Make flow vertical (top to bottom) with scrolling.
- Show only essential event-level details on hover.

## Completed
- Reworked Selected Journey into a vertical timeline with scroll:
  - Added timeline container with vertical line and event nodes.
  - Added overflow scroll for long journeys.
- Removed non-needed bubbles from the main visual path:
  - Removed Lead bubble.
  - Removed Scheduled Call bubble.
- Kept only two headline bubbles in the path:
  - Ad Click
  - Purchase
- Added attribution confidence directly inside Ad Click bubble.
- Added readable metadata above timeline:
  - User
  - Confidence
  - Ad/Campaign source
  - Landing page
  - Leads count (summary title style, not a path bubble)
- Added event timeline construction from session data:
  - Maps event names to human-readable labels.
  - Computes approximate dwell time per event (based on next timestamp).
- Added event-level hover details (essential only):
  - Time spent
  - Page
  - Item (if available)
- Added historical fallback timeline construction from purchase data:
  - Ad Click -> Landing (if available) -> Purchase
- Reduced visual noise in long journeys:
  - Added condensation logic for repeated low-signal events (especially dense page views).
  - Keeps key moments and inserts a compact summary node when events are skipped.
- Added sticky mini-header inside the timeline:
  - Shows that the timeline is scrollable.
  - Displays current visible event count for quick orientation.

## Pending / Next checks
- Validate final visual density on real data with many events.
- Confirm whether dwell time heuristic matches business expectations.
- Optional: tune condensation thresholds by store size (small vs high-traffic stores).
- Optional: add toggle to switch between "Condensed" and "Full" timeline.

## Notes
- This file tracks implementation steps and remaining polish items for the Selected Journey redesign.
