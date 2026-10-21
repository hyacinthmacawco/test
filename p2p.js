
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" }
];

export function createP2P({
  onMessage = () => {},
  onLocalCode = () => {},
  onConnectionState = () => {},
  onError = () => {}
} = {}) {
  let pc = null;
  let channel = null;
  let busy = false;
  let generation = 0;

  function notifyState() {
    onConnectionState({
      connected: channel?.readyState === "open",
      connectionState: pc?.connectionState ?? "new",
      channelState: channel?.readyState ?? "closed"
    });
  }

  function close() {
    generation++;

    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.close();
    }

    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.close();
    }

    channel = null;
    pc = null;
    busy = false;
    notifyState();
  }

  function setupChannel(dataChannel) {
    channel = dataChannel;

    channel.onopen = () => notifyState();

    channel.onclose = () => notifyState();

    channel.onerror = () => {
      onError("The data channel encountered an error.");
    };

    channel.onmessage = event => {
      onMessage(String(event.data));
    };

    notifyState();
  }

  function makePeer() {
    pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS
    });

    pc.onconnectionstatechange = () => {
      notifyState();

      if (pc?.connectionState === "failed") {
        onError(
          "Connection failed. Try exchanging new connection codes."
        );
      }
    };

    pc.ondatachannel = event => {
      setupChannel(event.channel);
    };

    return pc;
  }

  function waitForIce(peer, token) {
    if (peer.iceGatheringState === "complete") {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;

        clearTimeout(timeout);
        peer.removeEventListener(
          "icegatheringstatechange",
          checkState
        );

        resolve();
      };

      const checkState = () => {
        if (
          peer.iceGatheringState === "complete" ||
          token !== generation
        ) {
          finish();
        }
      };

      const timeout = setTimeout(finish, 15000);

      peer.addEventListener(
        "icegatheringstatechange",
        checkState
      );

      checkState();
    });
  }

  async function createOffer() {
    close();

    const token = generation;
    const peer = makePeer();

    setupChannel(peer.createDataChannel("chat"));

    try {
      const offer = await peer.createOffer();
      if (token !== generation) return;

      await peer.setLocalDescription(offer);
      await waitForIce(peer, token);

      if (token !== generation) return;

      onLocalCode(
        JSON.stringify(peer.localDescription),
        "offer"
      );
    } catch (error) {
      if (token === generation) {
        onError("Could not create request: " + error.message);
      }
    }
  }

  async function processCode(raw, currentStage) {
    if (busy || !raw.trim()) return;

    let data;

    try {
      data = JSON.parse(raw.trim());
    } catch {
      onError("The connection code is not valid JSON.");
      return;
    }

    if (
      !data ||
      !["offer", "answer"].includes(data.type) ||
      typeof data.sdp !== "string"
    ) {
      onError("This is not a valid WebRTC connection code.");
      return;
    }

    if (data.type === "offer" && currentStage !== "offer") {
      onError("This request does not match the current step.");
      return;
    }

    if (data.type === "answer" && currentStage !== "offer") {
      onError("This answer does not match the current step.");
      return;
    }

    busy = true;
    const token = generation;

    try {
      if (data.type === "offer") {
        // Replace this tab's unused offer with the incoming offer.
        close();
        const newToken = generation;
        const peer = makePeer();

        await peer.setRemoteDescription(data);
        if (newToken !== generation) return;

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await waitForIce(peer, newToken);

        if (newToken !== generation) return;

        onLocalCode(
          JSON.stringify(peer.localDescription),
          "answer"
        );
      } else {
        if (!pc) {
          onError("Create a request before entering an answer.");
          return;
        }

        await pc.setRemoteDescription(data);
        if (token !== generation) return;

        notifyState();
      }
    } catch (error) {
      if (token === generation) {
        onError("Could not use that code: " + error.message);
      }
    } finally {
      busy = false;
    }
  }

  function sendMessage(text) {
    if (!channel || channel.readyState !== "open") {
      throw new Error("The connection is not open.");
    }

    channel.send(text);
  }

  function isConnected() {
    return channel?.readyState === "open";
  }

  return {
    createOffer,
    processCode,
    sendMessage,
    isConnected,
    close
  };
}
