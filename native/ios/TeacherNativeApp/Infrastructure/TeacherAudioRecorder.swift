import AVFoundation
import Foundation

final class NativeAudioRecorderClient: NSObject, AudioRecorderClient {
    private var recorder: AVAudioRecorder?
    private var currentURL: URL?

    func permissionStatus() async -> RecorderPermissionStatus {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            return .granted
        case .denied:
            return .denied
        default:
            return .undetermined
        }
    }

    func requestPermission() async -> RecorderPermissionStatus {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted ? .granted : .denied)
            }
        }
    }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.allowBluetooth, .defaultToSpeaker])
        try session.setActive(true, options: [])

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("teacher-\(UUID().uuidString)")
            .appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.prepareToRecord()
        guard recorder.record() else {
            throw TeacherAPIError.http(statusCode: 500, message: "録音を開始できませんでした。")
        }
        self.currentURL = url
        self.recorder = recorder
    }

    func stop() throws -> URL {
        recorder?.stop()
        guard let currentURL else {
            throw TeacherAPIError.http(statusCode: 500, message: "録音ファイルが見つかりません。")
        }
        recorder = nil
        self.currentURL = nil
        try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        return currentURL
    }

    func cancel() throws {
        recorder?.stop()
        if let currentURL {
            try? FileManager.default.removeItem(at: currentURL)
        }
        recorder = nil
        currentURL = nil
        try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
