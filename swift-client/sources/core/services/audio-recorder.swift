import AVFoundation

@MainActor
final class AudioRecorder: ObservableObject {
  @Published var isRecording = false
  @Published var elapsed: TimeInterval = 0

  private var recorder: AVAudioRecorder?
  private var timer: Timer?

  func start() async {
    let session = AVAudioSession.sharedInstance()
    session.requestRecordPermission { _ in }
    try? session.setCategory(.record, mode: .default)
    try? session.setActive(true, options: .notifyOthersOnDeactivation)

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("m4a")
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 12000,
      AVNumberOfChannelsKey: 1,
      AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]
    recorder = try? AVAudioRecorder(url: url, settings: settings)
    recorder?.record()
    elapsed = 0
    isRecording = true
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
      self.elapsed += 1
    }
  }

  func stop() -> URL? {
    defer {
      recorder = nil
      isRecording = false
      timer?.invalidate()
      timer = nil
    }
    recorder?.stop()
    return recorder?.url
  }
}
