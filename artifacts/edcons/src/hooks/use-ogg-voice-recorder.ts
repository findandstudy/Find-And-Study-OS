import { useCallback, useEffect, useRef, useState } from "react";
import Recorder from "opus-recorder";
import encoderPath from "opus-recorder/dist/encoderWorker.min.js?url";
import { voiceRecorderStartError } from "./voice-recorder-errors";

const MAX_RECORDING_SECONDS = 5 * 60;
const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface OggVoiceRecorder {
  isRecording: boolean;
  seconds: number;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

export function useOggVoiceRecorder(
  onRecorded: (file: File) => void,
  onError: (message: string) => void,
): OggVoiceRecorder {
  const recorderRef = useRef<Recorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const onRecordedRef = useRef(onRecorded);
  const onErrorRef = useRef(onError);
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMicrophone = useCallback(() => {
    const sourceNode = sourceNodeRef.current;
    sourceNodeRef.current = null;
    try {
      sourceNode?.disconnect();
    } catch {
      // The recorder may already have disconnected the source.
    }

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => {
        // Best-effort cleanup; the browser may already be closing the context.
      });
    }
  }, []);

  const finish = useCallback(() => {
    clearTimer();
    setIsRecording(false);
    setSeconds(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      const closeResult = recorder?.close();
      if (closeResult) {
        void closeResult.catch(() => {
          // The encoder worker may already be closed after stop().
        });
      }
    } catch {
      // The encoder worker may already be closed after stop().
    }
    releaseMicrophone();
  }, [clearTimer, releaseMicrophone]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    clearTimer();
    try {
      void recorder.stop().catch(() => {
        finish();
        onErrorRef.current("Voice recording could not be finalized.");
      });
    } catch {
      finish();
      onErrorRef.current("Voice recording could not be finalized.");
    }
  }, [clearTimer, finish]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    if (!Recorder.isRecordingSupported()) {
      onErrorRef.current("Voice recording is not supported by this browser.");
      return;
    }

    cancelledRef.current = false;
    let audioContext: AudioContext;
    try {
      const webkitAudioContext = (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
      const AudioContextConstructor = window.AudioContext ?? webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("AudioContext is not supported");
      }
      audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
      await audioContext.resume();
    } catch (error) {
      releaseMicrophone();
      onErrorRef.current(voiceRecorderStartError(error, "encoder"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: MICROPHONE_CONSTRAINTS,
      });
      streamRef.current = stream;
    } catch (error) {
      releaseMicrophone();
      onErrorRef.current(voiceRecorderStartError(error, "permission"));
      return;
    }

    try {
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const recorder = new Recorder({
        encoderPath,
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderBitRate: 24_000,
        encoderSampleRate: 48_000,
        monitorGain: 0,
        streamPages: false,
        mediaTrackConstraints: false,
        sourceNode,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (data) => {
        if (cancelledRef.current || data.byteLength === 0) return;
        const file = new File(
          [data],
          `voice-note-${new Date().toISOString().replace(/[:.]/g, "-")}.ogg`,
          { type: "audio/ogg" },
        );
        onRecordedRef.current(file);
      };
      recorder.onstop = finish;

      await recorder.start();
      startedAtRef.current = Date.now();
      setSeconds(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) stop();
      }, 250);
    } catch (error) {
      finish();
      onErrorRef.current(voiceRecorderStartError(error, "encoder"));
    }
  }, [finish, releaseMicrophone, stop]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      clearTimer();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      try {
        const closeResult = recorder?.close();
        if (closeResult) void closeResult.catch(() => undefined);
      } catch {
        // Best-effort cleanup during unmount.
      }
      releaseMicrophone();
    },
    [clearTimer, releaseMicrophone],
  );

  return {
    isRecording,
    seconds,
    isSupported:
      typeof window !== "undefined" && Recorder.isRecordingSupported(),
    start,
    stop,
    cancel,
  };
}
