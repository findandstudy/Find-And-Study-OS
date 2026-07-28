declare module "opus-recorder" {
  interface RecorderConfig {
    encoderPath?: string;
    mediaTrackConstraints?: MediaTrackConstraints | boolean;
    monitorGain?: number;
    numberOfChannels?: 1 | 2;
    recordingGain?: number;
    encoderApplication?: 2048 | 2049 | 2051;
    encoderBitRate?: number;
    encoderComplexity?: number;
    encoderFrameSize?: number;
    encoderSampleRate?: 8000 | 12000 | 16000 | 24000 | 48000;
    streamPages?: boolean;
    sourceNode?: MediaStreamAudioSourceNode;
  }

  export default class Recorder {
    constructor(config?: RecorderConfig);
    static isRecordingSupported(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): Promise<void> | void;
    ondataavailable: (data: ArrayBuffer) => void;
    onstart: () => void;
    onstop: () => void;
  }
}
