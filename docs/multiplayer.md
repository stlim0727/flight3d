# Fly and talk with a friend

1. Open **Fly together** in the main menu. Multiplayer setup and room controls
   use a modal dialog. Background simulator controls cannot be used while it is
   open, and your own aircraft is held.
2. Enter your name. Under **Host a flight**, choose the stage, aircraft, and
   runway/cruise start, then choose
   **Create room · max 2**. Share the six-character code (for example `K7M 2QX`)
   or use **Copy invite** for a compact link ending in `?r=K7M2QX`.
3. While waiting to start, the creator must press **Keep room open** before the
   thirty-second countdown ends. Each press grants another thirty seconds. Missing a
   press cancels the room; it cannot be revived by pressing late.
4. Opening the shared invite link automatically joins your friend's room and
   opens its dialog; no typing, pasting, or Join button is needed. With a code,
   enter it under **Join a friend** and choose **Join friend**. The host's stage
   and aircraft apply to both pilots. Spaces, hyphens,
   and lowercase letters are accepted. The creator chooses **Start together**;
   both dialogs close when the shared flight is ready. The waiting deadline no
   longer applies after starting preparation or during flight.
5. Open **Room** to change voice settings, reset or restart, or leave. Your plane
   stays held while this dialog is open; the other pilot may continue flying.
   Closing it resumes only the pause introduced by the dialog. A pause you set
   yourself stays paused.

Voice is on by default when you create or join a room. Allow microphone access
when the browser asks; then speak normally without holding a key or button.
Use **Mute microphone** / **Unmute microphone** in the room dialog. Voice
continues during flight and while the dialog is open. If permission is denied,
you can still listen and choose **Enable microphone** to retry. **Mute friend**
affects only what you hear. If playback is blocked, choose **Play friend’s voice**.

Your pilot name, scenery, aircraft, and start selection are saved in this browser
and restored on your next visit, including when opening an invite link.

The room holds two pilots including its creator. It supports the C172, B738 and
F16 at coastal airport, Incheon and neon city. Both use the creator's aircraft
type. Cruise places the guest beside the creator; runway starts put the guest
80 m behind. Remote aircraft are simplified blue models without collisions.
**Reset my aircraft** returns only you to your slot; **Restart together** starts
both pilots again. There is no automatic takeoff clearance or scoring.

A cancelled room releases its media and cannot accept players. Later joiners
receive a cancellation message. If the creator's tab is gone or its cancelled
address has been released, the message says the room was cancelled or is
unavailable and asks for a new code. Losing either pilot ends the session.

Invite trusted friends: peer-to-peer connections can reveal IP addresses. The
app does not record voice. It uses external PeerJS services, so some networks
may prevent connections. See [implementation and verification](development/multiplayer.md).
