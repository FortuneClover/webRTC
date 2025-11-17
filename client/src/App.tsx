import React, { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

type Cam = { deviceId: string; label: string };
type Mic = { deviceId: string; label: string };

const CAM_OFF = "__OFF__CAM__";
const MIC_OFF = "__OFF__MIC__";

const VideoChat = () => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cams, setCams] = useState<Cam[]>([]);
  const [mics, setMics] = useState<Mic[]>([]);
  const [currentCamId, setCurrentCamId] = useState<string | null>(null);
  const [currentMicId, setCurrentMicId] = useState<string | null>(null);

  const [micEnabled, setMicEnabled] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [isStartedVideo, setIsStartedVideo] = useState(false);
  const [room] = useState("test_room");

  // ── 장치 새로고침 ─────────────────────────────
  const refreshDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setCams(
      devices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || "Camera" }))
    );
    setMics(
      devices
        .filter(d => d.kind === "audioinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || "Microphone" }))
    );
  };

  // ── 마이크 미터 ─────────────────────────────
  const startMeter = (stream: MediaStream) => {
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;

      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel(Math.min(100, Math.round(rms * 140)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  };
  const stopMeter = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setMicLevel(0);
  };

  // ── 비디오 시작 ─────────────────────────────
  const startVideo = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video:
          !currentCamId || currentCamId === CAM_OFF
            ? false
            : { deviceId: { exact: currentCamId } },
        audio:
          !currentMicId || currentMicId === MIC_OFF
            ? false
            : { deviceId: { exact: currentMicId } },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // 마이크 레벨
      if (stream.getAudioTracks().length) startMeter(stream);

      // WebRTC로 전송
      stream.getTracks().forEach(track => peerConnection?.addTrack(track, stream));

      socket?.emit("join", { room });
      setIsStartedVideo(true);
    } catch (err) {
      console.error("❌ 카메라/마이크 시작 실패:", err);
    }
  };

  // ── WebRTC + Socket.IO 초기화 ─────────────────────────────
  useEffect(() => {
    const s = io("http://localhost:5000");
    setSocket(s);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = e => {
      if (e.candidate) s.emit("candidate", { candidate: e.candidate, room });
    };

    pc.ontrack = e => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    // Offer 수신
    s.on("offer", async msg => {
      if (msg.sender === s.id) return;
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit("answer", { sdp: answer, room });
    });

    // Answer 수신
    s.on("answer", async msg => {
      if (msg.sender === s.id) return;
      await pc.setRemoteDescription(msg.sdp);
    });

    // ICE candidate 수신
    s.on("candidate", async msg => {
      if (msg.sender === s.id) return;
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    });

    setPeerConnection(pc);
    refreshDevices();

    return () => {
      pc.close();
      s.disconnect();
      streamRef.current?.getTracks().forEach(t => t.stop());
      stopMeter();
    };
  }, []);

  const toggleMic = () => {
    if (!streamRef.current) return;
    const enabled = !micEnabled;
    streamRef.current.getAudioTracks().forEach(t => (t.enabled = enabled));
    setMicEnabled(enabled);
  };

  const call = async () => {
    if (!peerConnection) return;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket?.emit("offer", { sdp: offer, room });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center gap-2">
        <div className="flex flex-col items-center">
          <div>내 화면</div>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 300 }} />
        </div>
        <div className="flex flex-col items-center">
          <div>상대 화면</div>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: 300 }} />
        </div>
      </div>

      <div className="flex gap-2">
        <select
          value={currentCamId || ""}
          onChange={e => setCurrentCamId(e.target.value || null)}
        >
          <option value="">기본 카메라</option>
          <option value={CAM_OFF}>끄기</option>
          {cams.map(c => (
            <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
          ))}
        </select>

        <select
          value={currentMicId || ""}
          onChange={e => setCurrentMicId(e.target.value || null)}
        >
          <option value="">기본 마이크</option>
          <option value={MIC_OFF}>끄기</option>
          {mics.map(m => (
            <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
          ))}
        </select>

        <button onClick={toggleMic}>{micEnabled ? "마이크 끄기" : "마이크 켜기"}</button>
        {!isStartedVideo && <button onClick={startVideo}>비디오 시작</button>}
        <button onClick={call}>통화 시작</button>
      </div>

      <div className="w-44 h-2 bg-gray-200 rounded mt-2">
        <div className="h-2 bg-green-500 rounded" style={{ width: `${micLevel}%` }} />
      </div>
    </div>
  );
};

export default VideoChat;
