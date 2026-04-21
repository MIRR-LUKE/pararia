import Foundation
import SwiftUI

@MainActor
final class TeacherAppCoordinator: ObservableObject {
    @Published var route: TeacherRoute = .bootstrap
    @Published var session: TeacherSession?
    @Published var pendingUploads: [PendingUpload] = []
    @Published var errorMessage: String?
    @Published var recordingSummary: TeacherRecordingSummary?

    private let authRepository: TeacherAuthRepository
    private let recordingRepository: TeacherRecordingRepository
    private let recorder: AudioRecorderClient
    private let pendingStore: PendingUploadStore

    private var activeRecordingId: String?
    private var recordingStartedAt: Date?
    private var timerTask: Task<Void, Never>?
    private var doneTask: Task<Void, Never>?

    init(
        authRepository: TeacherAuthRepository,
        recordingRepository: TeacherRecordingRepository,
        recorder: AudioRecorderClient,
        pendingStore: PendingUploadStore
    ) {
        self.authRepository = authRepository
        self.recordingRepository = recordingRepository
        self.recorder = recorder
        self.pendingStore = pendingStore
        self.pendingUploads = (try? pendingStore.loadItems()) ?? []
    }

    func bootstrap() async {
        errorMessage = nil
        session = await authRepository.currentSession()
        if session == nil {
            route = .bootstrap
            return
        }
        if let active = try? await recordingRepository.loadActiveRecording() {
            recordingSummary = active
            if let active {
                switch active.status {
                case .awaitingStudentConfirmation:
                    route = .confirm(active)
                    return
                case .transcribing:
                    route = .analyzing(recordingId: active.id, message: "生徒候補を確認しています。")
                    await resumeProgress(recordingId: active.id)
                    return
                case .studentConfirmed:
                    showDoneScreen()
                    return
                default:
                    break
                }
            }
        }
        route = .standby
    }

    func login(email: String, password: String, deviceLabel: String) async {
        errorMessage = nil
        do {
            session = try await authRepository.login(input: DeviceLoginInput(email: email, password: password, deviceLabel: deviceLabel))
            route = .standby
        } catch {
            if let recordingId = activeRecordingId {
                try? await recordingRepository.cancelRecording(recordingId: recordingId)
                activeRecordingId = nil
            }
            errorMessage = error.localizedDescription
        }
    }

    func openPending() {
        pendingUploads = (try? pendingStore.loadItems()) ?? []
        route = .pending
    }

    func returnToStandby() {
        doneTask?.cancel()
        route = .standby
    }

    func startRecording() async {
        errorMessage = nil
        do {
            let currentPermission = await recorder.permissionStatus()
            let permission = currentPermission == .undetermined
                ? await recorder.requestPermission()
                : currentPermission
            guard permission == .granted else {
                errorMessage = "マイクを許可してください。"
                return
            }
            let recordingId = try await recordingRepository.createRecording()
            do {
                try recorder.start()
            } catch {
                try? await recordingRepository.cancelRecording(recordingId: recordingId)
                throw error
            }
            activeRecordingId = recordingId
            recordingStartedAt = Date()
            startTimer()
        } catch {
            activeRecordingId = nil
            recordingStartedAt = nil
            errorMessage = error.localizedDescription
        }
    }

    func stopRecording() async {
        errorMessage = nil
        do {
            guard let recordingId = activeRecordingId else { return }
            let fileURL = try recorder.stop()
            let duration = recordingStartedAt.map { Date().timeIntervalSince($0) }
            timerTask?.cancel()
            activeRecordingId = nil
            recordingStartedAt = nil
            route = .analyzing(recordingId: recordingId, message: "音声を送信しています。")
            _ = try await recordingRepository.uploadAudio(recordingId: recordingId, fileURL: fileURL, durationSeconds: duration)
            let summary = try await recordingRepository.pollRecording(recordingId: recordingId)
            apply(summary: summary)
        } catch {
            activeRecordingId = nil
            recordingStartedAt = nil
            timerTask?.cancel()
            errorMessage = error.localizedDescription
            pendingUploads = (try? pendingStore.loadItems()) ?? pendingUploads
            route = .standby
        }
    }

    func cancelRecording() async {
        errorMessage = nil
        timerTask?.cancel()
        do {
            let recordingId = activeRecordingId
            try recorder.cancel()
            if let recordingId {
                try? await recordingRepository.cancelRecording(recordingId: recordingId)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        activeRecordingId = nil
        recordingStartedAt = nil
        route = .standby
    }

    func confirmStudent(studentId: String?) async {
        guard case .confirm(let summary) = route else { return }
        do {
            try await recordingRepository.confirmStudent(recordingId: summary.id, studentId: studentId)
            showDoneScreen()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func retryPendingUploads() async {
        errorMessage = nil
        do {
            try await recordingRepository.retryPendingUploads()
            pendingUploads = (try? pendingStore.loadItems()) ?? []
            route = .standby
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() async {
        doneTask?.cancel()
        timerTask?.cancel()
        activeRecordingId = nil
        recordingStartedAt = nil
        await authRepository.logout()
        session = nil
        route = .bootstrap
    }

    private func apply(summary: TeacherRecordingSummary) {
        recordingSummary = summary
        switch summary.status {
        case .awaitingStudentConfirmation:
            route = .confirm(summary)
        case .studentConfirmed:
            showDoneScreen()
        case .error:
            errorMessage = summary.errorMessage
            route = .standby
        default:
            route = .standby
        }
    }

    private func startTimer() {
        timerTask?.cancel()
        route = .recording(seconds: 0)
        timerTask = Task { [weak self] in
            var seconds = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                seconds += 1
                await MainActor.run {
                    self?.route = .recording(seconds: seconds)
                }
            }
        }
    }

    private func showDoneScreen() {
        activeRecordingId = nil
        recordingStartedAt = nil
        route = .done(title: "送信しました", message: "ログを作成しています。")
        doneTask?.cancel()
        doneTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            await MainActor.run {
                self?.route = .standby
            }
        }
    }

    private func resumeProgress(recordingId: String) async {
        do {
            let summary = try await recordingRepository.pollRecording(recordingId: recordingId)
            apply(summary: summary)
        } catch {
            errorMessage = error.localizedDescription
            route = .standby
        }
    }
}
