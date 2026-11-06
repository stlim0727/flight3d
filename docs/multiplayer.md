# Fly and talk with a friend

1. Open **Fly together** in the main menu. Enter your name and choose the shared
   scenery, aircraft, and runway or cruise start.
2. Choose **Create room · max 2**, then copy the invite link to one friend.
3. Your friend opens that link and chooses **Join friend**. Both pilots see the
   same room configuration; the host chooses **Start together**.
4. Choose **Enable microphone**, then hold **N** or **Hold to talk** to speak.
   Release to stop. Microphone access is optional: you can listen without it.
   **Mute friend** affects only what you hear. If the browser blocks playback,
   choose **Play friend’s voice**.

The room holds two pilots including the host. It supports the C172, B738 and F16
at coastal airport, Incheon and neon city. The host selects one shared aircraft
type. Cruise places the guest beside the host; runway starts put the guest 80 m
behind. Remote aircraft are blue simplified models and do not collide with you.
There is no automatic takeoff clearance or scoring in this shared flight mode.

**Reset my aircraft** returns only you to your slot, including after a crash.
The host can **Restart together**. Menus, pause and background tabs hold your own
plane; the other pilot sees a paused indicator. Keep the flight tab visible to
fly. **Leave room** releases the microphone and returns both players to solo
flight. If either pilot loses connection, create a new room to reconnect.

Invite only trusted friends: peer-to-peer connections can reveal IP addresses.
The app does not record voice. The static site uses external PeerJS connection
services; a room needs its host tab open, and restrictive networks can prevent
connections. Try another network or recreate the room if connection fails.
Cross-network and mobile-browser support depends on WebRTC and available relay
services; see [implementation and verification](development/multiplayer.md).
