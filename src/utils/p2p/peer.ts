// A minimal RTCPeerConnection wrapper: no third-party WebRTC helper library, because the
// surface this needs — create an offer or answer, trickle ICE candidates through the
// signaling mailbox, and hand back an open data channel — is small enough to own directly.
//
// Both connection roles (the device that starts the handshake, and the device that responds
// to it) share one function below rather than two near-duplicate ones, since the only real
// difference is who sends the offer and who sends the answer; everything else (ICE trickling,
// polling the mailbox, waiting for the channel to open) is identical.

import { getMessages, postMessage, type RoomMode } from "./signaling";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** How often to poll the signaling mailbox for the other side's SDP/ICE messages. Only runs
 * during the handshake — once the data channel opens, polling stops. */
const SIGNAL_POLL_MS = 500;

/** How long to wait for the data channel to open before giving up and falling back. */
const CONNECT_TIMEOUT_MS = 20_000;

export type PeerRole = "offerer" | "answerer";

export interface P2PSession {
  channel: RTCDataChannel;
  close(): void;
}

export interface ConnectOptions {
  roomId: string;
  deviceId: string;
  role: PeerRole;
}

/**
 * connect performs the WebRTC handshake over the signaling mailbox and resolves once a data
 * channel is open between this device and the other side of roomId. The offerer creates the
 * data channel up front (required by the API — only the offering side can); the answerer
 * receives it via the "datachannel" event once the offer arrives.
 */
export function connect(opts: ConnectOptions): Promise<P2PSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channelReady =
    opts.role === "offerer"
      ? Promise.resolve(pc.createDataChannel("transfer", { ordered: true }))
      : new Promise<RTCDataChannel>((resolve) => {
          pc.ondatachannel = (e) => resolve(e.channel);
        });

  pc.onicecandidate = (e) => {
    if (e.candidate) void postMessage(opts.roomId, opts.deviceId, "ice", e.candidate.toJSON());
  };

  let stopped = false;
  const pollLoop = pollSignalingMailbox(pc, opts, () => stopped);

  return (async () => {
    try {
      if (opts.role === "offerer") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postMessage(opts.roomId, opts.deviceId, "offer", offer);
      }

      const channel = await channelReady;
      await waitForOpen(channel, pc);
      stopped = true;
      await pollLoop;

      return {
        channel,
        close: () => {
          stopped = true;
          channel.close();
          pc.close();
        },
      };
    } catch (err) {
      stopped = true;
      pc.close();
      throw err;
    }
  })();
}

/** pollSignalingMailbox repeatedly fetches new messages and applies offers/answers/ICE
 * candidates to pc until stopped() reports true (the channel has opened, or connect failed). */
async function pollSignalingMailbox(pc: RTCPeerConnection, opts: ConnectOptions, stopped: () => boolean): Promise<void> {
  let since = 0;
  while (!stopped()) {
    let messages: Awaited<ReturnType<typeof getMessages>>["messages"];
    try {
      messages = (await getMessages(opts.roomId, opts.deviceId, since)).messages;
    } catch {
      await sleep(SIGNAL_POLL_MS);
      continue;
    }
    for (const msg of messages) {
      since = Math.max(since, msg.seq);
      try {
        if (msg.kind === "offer" && opts.role === "answerer") {
          await pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await postMessage(opts.roomId, opts.deviceId, "answer", answer);
        } else if (msg.kind === "answer" && opts.role === "offerer") {
          await pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit);
        } else if (msg.kind === "ice") {
          await pc.addIceCandidate(msg.payload as RTCIceCandidateInit);
        }
      } catch {
        // A stray or out-of-order ICE candidate is routine (e.g. arriving before the remote
        // description is set) — skipping it costs nothing since ICE tries every candidate.
      }
    }
    if (!stopped()) await sleep(SIGNAL_POLL_MS);
  }
}

function waitForOpen(channel: RTCDataChannel, pc: RTCPeerConnection): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("P2P connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onStateChange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanup();
        reject(new Error(`P2P connection ${pc.connectionState}`));
      }
    };
    function cleanup() {
      clearTimeout(timer);
      channel.removeEventListener("open", onOpen);
      pc.removeEventListener("connectionstatechange", onStateChange);
    }
    channel.addEventListener("open", onOpen);
    pc.addEventListener("connectionstatechange", onStateChange);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { RoomMode };
