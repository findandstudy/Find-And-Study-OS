import { useCallback, useEffect, useRef, useState } from "react";
import Recorder from "opus-recorder";
import encoderPath from "opus-recorder/dist/encoderWorker.min.js?url";

const MAX_RECORDING_SECONDS = 5 * 60;

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

  const finish = useCallback(() => {
    clearTimer();
    setIsRecording(false);
    setSeconds(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      recorder?.close();
    } catch {
      // The encoder worker may already be closed after stop().
    }
  }, [clearTimer]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    clearTimer();
    try {
      recorder.stop();
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
    const recorder = new Recorder({
      encoderPath,
      numberOfChannels: 1,
      encoderApplication: 2048,
      encoderBitRate: 24_000,
      encoderSampleRate: 48_000,
      monitorGain: 0,
      streamPages: false,
      mediaTrackConstraints: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
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

    try {
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
      const permissionDenied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      onErrorRef.current(
        permissionDenied
          ? "Microphone permission is required to record a voice message."
          : "Microphone could not be started.",
      );
    }
  }, [finish, stop]);

  useEffect(() => () => {
    cancelledRef.current = true;
    clearTimer();
    try {
      recorderRef.current?.close();
    } catch {
      // Best-effort cleanup during unmount.
    }
    recorderRef.current = null;
  }, [clearTimer]);

  return {
    isRecording,
    seconds,
    isSupported: typeof window !== "undefined" && Recorder.isRecordingSupported(),
    start,
    stop,
    cancel,
  };
}
